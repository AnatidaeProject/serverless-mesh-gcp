import { random } from "lodash";
import * as admin from "firebase-admin";
import {
  GenericObject,
  Serializer,
  Serializers,
  Discoverers,
  DiscovererOptions,
  Errors,
  ServiceBroker,
  LoggerInstance,
  BrokerNode,
  Packets,
  ServiceRegistry,
} from "moleculer";
import { inspect } from "util";

// TODO Typing is wrong so the exports are not mapping correctly
const METRIC = {
  TYPE_COUNTER: "counter",
  TYPE_GAUGE: "gauge",
  TYPE_HISTOGRAM: "histogram",
  TYPE_INFO: "info",
  UNIT_MILLISECONDS: "millisecond",
};
function removeFromArray(arr, item) {
  if (!arr || arr.length == 0) return arr;
  const idx = arr.indexOf(item);
  if (idx !== -1) arr.splice(idx, 1);
  return arr;
}

export const MOLECULER_DISCOVERER_FIRESTORE_COLLECT_TOTAL =
  "moleculer.discoverer.firebase.collect.total";
export const MOLECULER_DISCOVERER_FIRESTORE_COLLECT_TIME =
  "moleculer.discoverer.firebase.collect.time";

export function moleculerDiscovererFirebase(): string {
  return "moleculer-discoverer-firebase";
}

interface OnlineNode {
  sender: string;
  instanceId: string;
  seq: number;
  ver: string;
  cpu: string;
  // [key: string]: unknown;
}

export interface FirebaseDiscoveryOptions extends DiscovererOptions {
  serializer?: Serializer | string | GenericObject;
  firebaseApp?: admin.app.App;
  databaseUrl?: string;
  realtimeDbPath?: string;
}

export class FirebaseDiscoverer extends Discoverers.Base {
  private registry: ServiceRegistry; // Set by super()
  private broker: ServiceBroker; // Set by super()
  private logger: LoggerInstance; // Set by super()
  localNode: BrokerNode; // Set by super() ... any?!?!?
  private opts: FirebaseDiscoveryOptions;
  private readonly fbAdmin: admin.app.App;
  private db: admin.database.Database;
  private discoveryRef: admin.database.Reference;
  private nodeRef: admin.database.Reference;
  private disconnectRef: admin.database.OnDisconnect;
  // Set in init
  private serializer: Serializer;
  private idx: number;
  private PREFIX: string;
  private BEAT_KEY: string;
  private INFO_KEY: string;
  private lastInfoSeq: number;
  private lastBeatSeq: number;
  private reconnecting: boolean;
  /**
   * Creates an instance of Discoverer.
   *
   * @memberof BaseDiscoverer
   */
  constructor(opts: FirebaseDiscoveryOptions = {}) {
    if (typeof opts === "string") opts = { firestore: opts };
    super(opts);
    this.opts = {
      realtimeDbPath: "moleculer_discovery",
      ...opts,
      serializer: "JSON",
    };
    this.fbAdmin = opts?.firebaseApp || this.initFirebaseApp();
    // Last sequence numbers
    this.lastInfoSeq = 0;
    this.lastBeatSeq = 0;

    this.reconnecting = false;
  }

  initFirebaseApp() {
    //  Return cached reference
    if (this.fbAdmin) return this.fbAdmin;
    // Was initialized elsewhere, return the app
    if (admin.apps.length !== 0) return admin.app();
    // Init a firebase app
    const app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    // console.log(inspect(app.database("localhost:9000"), false, 10, true));
    return app;
  }

  init(registry) {
    if (!registry.broker) {
      throw new Errors.BrokerOptionsError(
        "Missing broker in Firebase Discovery Service",
        registry
      );
    }
    super.init(registry);

    this.db = this.fbAdmin.database(this.opts?.databaseUrl);
    this.discoveryRef = this.db.ref(this.opts.realtimeDbPath);
    console.log("Trying to save to the database");

    // Loop counter for full checks. Starts from a random value for better distribution
    this.idx = this.opts.fullCheck > 1 ? random(this.opts.fullCheck - 1) : 0;

    // Using shorter instanceID to reduce the network traffic
    const instanceHash =
      registry.broker.instanceID?.substring(0, 8) || `MISSING_BROKER_HASH`;

    this.PREFIX = `MOL${
      registry.broker.namespace ? "-" + registry.broker.namespace : ""
    }-DSCVR`;
    this.BEAT_KEY = `${this.PREFIX}-BEAT:${
      registry.broker.nodeID || "MISSING_BROKER_NODE_ID"
    }|${instanceHash}`;
    this.INFO_KEY = `${this.PREFIX}-INFO:${
      registry.broker.nodeID || "MISSING_BROKER_NODE_ID"
    }`;

    this.nodeRef = this.db.ref(
      `${this.opts.realtimeDbPath}/information/${this.INFO_KEY}`
    );

    // create an instance of serializer (default to JSON)
    const { resolve } = Serializers as any; // TODO: serializers/index.js | module.exports = Object.assign(Serializers, { resolve });  Needs proper exporting
    this.serializer = resolve(this.opts.serializer);
    this.serializer.init(this.broker);

    // Send data
    this.sendLocalNodeInfo();

    this.logger?.debug("Firebase Discoverer created. Prefix:", this.PREFIX);
  }

  /**
   * Register Moleculer Transit Core metrics.
   */
  registerMoleculerMetrics() {
    this.broker.metrics.register({
      name: MOLECULER_DISCOVERER_FIRESTORE_COLLECT_TOTAL,
      type: METRIC.TYPE_COUNTER,
      rate: true,
      description: "Number of Service Registry fetching from Redis",
    } as any); // TODO Make a PR to fix base types
    this.broker.metrics.register({
      name: MOLECULER_DISCOVERER_FIRESTORE_COLLECT_TIME,
      type: METRIC.TYPE_HISTOGRAM,
      quantiles: true,
      unit: METRIC.UNIT_MILLISECONDS,
      description: "Time of Service Registry fetching from Redis",
    } as any); // TODO Make a PR to fix base types
  }

  /**
   * Recreate the INFO key update timer.
   */
  recreateInfoUpdateTimer() {
    if (!this.opts.disableOfflineNodeRemoving) {
      this.disconnectRef = this.nodeRef.onDisconnect();
      this.disconnectRef.remove((err) => {
        if (err) {
          this.logger?.error(
            `Could not establish onDisconnect event: ${err.message}`
          );
        }
      });
    }
  }

  /**
   * Sending a local heartbeat to Firebase Realtime Database.
   * Org code, looks like it uses a has and a sequence number, might not be great for serverless
   */
  async sendHeartbeat(): Promise<void> {
    const timeEnd = this.broker.metrics.timer(
      MOLECULER_DISCOVERER_FIRESTORE_COLLECT_TIME
    );
    const data = {
      sender: this.broker.nodeID,
      ver: this.broker.PROTOCOL_VERSION,

      // timestamp: Date.now(),
      cpu: this.localNode.cpu,
      seq: this.localNode.seq,
      instanceID: this.broker.instanceID,
    };
    const seq = this.localNode.seq;
    const key = this.BEAT_KEY + "|" + seq;
    const lastKey = this.BEAT_KEY + "|" + this.lastBeatSeq;
    // TODO Typescript doesn't love that injected promise stuff... it's typed wrong or something
    return Promise.resolve()
      .then(() =>
        this.db
          .ref(`${this.opts.realtimeDbPath}/heartbeats/${lastKey}`)
          .remove()
      )
      .then(() =>
        this.db
          .ref(`${this.opts.realtimeDbPath}/heartbeats/${key}`)
          .set(this.serializer.serialize(data, Packets.PACKET_HEARTBEAT))
      )
      .then(() => (this.lastBeatSeq = seq))
      .then(() => this.collectOnlineNodes())
      .catch((err) =>
        this.logger.error(
          "Error occurred while scanning Realtime Database keys.",
          err
        )
      )
      .then(() => {
        timeEnd();
        this.broker.metrics.increment(
          MOLECULER_DISCOVERER_FIRESTORE_COLLECT_TOTAL
        );
      });
  }

  /**
   * Collect online nodes from Firebase Realtime Database
   */
  async collectOnlineNodes(): Promise<OnlineNode[]> {
    // Get the current node list so that we can check the disconnected nodes.
    const prevNodes = this.registry.nodes
      .list({ onlyAvailable: true, withServices: false })
      .map((node) => node.id)
      .filter((nodeID) => nodeID !== this.broker.nodeID);

    // Collect the online node keys.
    const onlineNodes = await this.db
      .ref(`${this.opts.realtimeDbPath}/heartbeats`)
      .once("value");

    if (!onlineNodes.exists() || !onlineNodes.hasChildren()) return [];

    const packets = [];
    // TODO: Refactor: I am not sure there is a difference or benefit from a full chek or lazy check with Firebase DB
    if (this.opts.fullCheck && ++this.idx % this.opts.fullCheck == 0) {
      // Full check
      //this.logger.debug("Full check", this.idx);
      this.idx = 0;

      onlineNodes.forEach((packet) => {
        const key = packet.key;
        const data = packet.val();
        try {
          const p = key.substring(`${this.PREFIX}-BEAT:`.length).split("|");
          packets.push({
            sender: p[0],
            instanceID: p[1],
            seq: Number(p[2]),
            ...this.serializer.deserialize(data, Packets.PACKET_HEARTBEAT),
          });
        } catch (err) {
          this.logger.warn("Unable to parse HEARTBEAT packet", err, data);
        }
      });
    } else {
      onlineNodes.forEach((packet) => {
        const key = packet.key;
        const p = key.substring(`${this.PREFIX}-BEAT:`.length).split("|");
        packets.push({
          sender: p[0],
          instanceID: p[1],
          seq: Number(p[2]),
        });
      });
      return;
    }
    // Process the packets now
    packets.map((packet) => {
      if (packet.sender == this.broker.nodeID) return;

      removeFromArray(prevNodes, packet.sender);
      this.heartbeatReceived(packet.sender, packet);
    });
    if (prevNodes.length > 0) {
      // Disconnected nodes
      prevNodes.forEach((nodeID) => {
        this.logger.info(
          `The node '${nodeID}' is not available. Removing from registry...`
        );
        this.remoteNodeDisconnected(nodeID, true);
      });
    }
  }

  /**
   * Discover a new or old node.
   *
   * @param {String} nodeID
   */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TODO: HORRIBLE typing in parent class, defines returning void but code returns BrokerNode
  async discoverNode(nodeID): Promise<BrokerNode | undefined> {
    // Get the node info
    const snapshot = await this.db
      .ref(
        `${this.opts.realtimeDbPath}/information/${this.PREFIX}-INFO:${nodeID}`
      )
      .once("value");
    if (!snapshot.exists()) {
      this.logger.warn(`No INFO for '${nodeID}' node in registry.`);
      return;
    }
    const data = snapshot.val();
    try {
      const info = this.serializer.deserialize(data, Packets?.PACKET_INFO);
      return this.processRemoteNodeInfo(nodeID, info);
    } catch (err) {
      this.logger.warn("Unable to parse INFO packet", err, data);
    }
  }

  /**
   * Discover all nodes (after connected)
   */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TODO: HORRIBLE typing in parent class, defines returning void but code returns ... well, any
  discoverAllNodes(): Promise<OnlineNode[]> {
    return this.collectOnlineNodes();
  }

  /**
   * Local service registry has been changed. We should notify remote nodes.
   * @param {String} nodeID
   */
  async sendLocalNodeInfo(nodeID?) {
    const info = this.broker.getLocalNodeInfo();

    const payload = Object.assign(
      {
        ver: this.broker.PROTOCOL_VERSION,
        sender: this.broker.nodeID,
      },
      info
    );

    const seq = this.localNode.seq;
    console.log("Saving node to firebase");
    const success = await this.nodeRef
      .set(this.serializer.serialize(payload, Packets?.PACKET_INFO))
      .catch((err) => {
        this.logger.error("Unable to send INFO to Redis server", err);
      });
    console.log(inspect(success, false, 3, true));
    this.lastInfoSeq = seq;
    this.recreateInfoUpdateTimer();
    // Sending a new heartbeat because it contains the `seq` ... weird it asked for nodeId
    if (!nodeID) return this.beat();
  }

  /**
   * Unregister local node after disconnecting.
   */
  async localNodeDisconnected() {
    await super.localNodeDisconnected();
    this.logger.debug("Remove local node from registry...");
    if (!this.opts.disableOfflineNodeRemoving) {
      await this.nodeRef.remove();
      const beats: string[] = [];
      await this.db
        .ref(`${this.opts.realtimeDbPath}/heartbeats`)
        .once("value")
        .then((snapshot) =>
          snapshot.forEach((item) => {
            if (item.key.startsWith(this.BEAT_KEY)) {
              beats.push(item.key);
            }
          })
        );
      await Promise.all(
        beats.map((beat) =>
          this.db.ref(`${this.opts.realtimeDbPath}/heartbeats/${beat}`).remove()
        )
      );
    }
  }
}

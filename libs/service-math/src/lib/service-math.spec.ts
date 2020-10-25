import { buildNode, serviceMath } from "./service-math";
import { FirebaseDiscoverer } from "@anatidaeproject/moleculer-discoverer-firebase";
import { Discoverers } from "moleculer";
import { inspect } from "util";
import * as admin from "firebase-admin";

describe("serviceMath", () => {
  it("should work", () => {
    expect(serviceMath()).toEqual("service-math");
  });

  it("Should build a local node with firebase", async () => {
    const url = "https://serverless-mesh-brianm.firebaseio.com";
    // const url = undefined;

    console.log("Connecting to firebase app");
    const firebaseApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: url,
    });

    console.log("Reading from firebase app");
    try {
      const snapshot = await firebaseApp.database().ref("boo").once("value");
      console.log(snapshot.val());
    } catch (err) {
      console.error("This did not save");
      throw err;
    }

    console.log("Writing to firebase app");
    try {
      await firebaseApp.database().ref("learning").set({ myValue: "THe Data" });
    } catch (err) {
      console.error("This did not save");
      throw err;
    }
    console.log("Saved data");

    const discoverer: any = new FirebaseDiscoverer({
      // databaseUrl: "http://localhost:9000/",
      databaseUrl: url,
      disableOfflineNodeRemoving: true,
      firebaseApp,
    });

    const node = buildNode({
      logLevel: "warn",
      nodeID: "math",
      namespace: "serverless",
      registry: {
        discoverer,
      },
    });
    // await new Promise((resolve) =>
    //   setTimeout(() => {
    //     console.log("Node made");
    //     resolve();
    //   }, 500)
    // );
    expect(node.start).toBeDefined();
    expect(node.stop).toBeDefined();
    expect(node.call).toBeDefined();
    await node.start();
    // await new Promise((resolve) =>
    //   setTimeout(() => {
    //     console.log("Node started");
    //     resolve();
    //   }, 500)
    // );
    const res = await node.call("math.add", { a: 5, b: 3 });
    console.log("5 + 3 =", res);
    expect(res).toEqual(8);
    // await new Promise((resolve) =>
    //   setTimeout(() => {
    //     console.log("Node called");
    //     resolve();
    //   }, 500)
    // );
    await node.stop();
  });
});

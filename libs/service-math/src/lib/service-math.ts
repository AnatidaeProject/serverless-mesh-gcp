export function serviceMath(): string {
    return "service-math";
}

import type { BrokerOptions } from "moleculer";
import { ServiceBroker } from "moleculer";

export interface BuildNodeOptions extends BrokerOptions {
    nodeID: string;
}

export function buildNode(brokerOptions: BuildNodeOptions): ServiceBroker {
    // brokerOptions.logLevel = "debug";
    // Create a ServiceBroker
    const broker = new ServiceBroker(brokerOptions);

    // Define a service
    broker.createService({
        name: "math",
        actions: {
            add(ctx) {
                return Number(ctx.params.a) + Number(ctx.params.b);
            },
        },
    });

    return broker;
}

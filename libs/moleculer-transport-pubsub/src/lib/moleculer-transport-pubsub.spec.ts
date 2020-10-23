import { moleculerTransportPubsub } from './moleculer-transport-pubsub';

describe('moleculerTransportPubsub', () => {
  it('should work', () => {
    expect(moleculerTransportPubsub()).toEqual('moleculer-transport-pubsub');
  });
});

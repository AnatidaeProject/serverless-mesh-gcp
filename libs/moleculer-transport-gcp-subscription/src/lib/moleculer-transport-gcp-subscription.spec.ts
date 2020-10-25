import * as admin from "firebase-admin";

describe("moleculerTransportGcpSubscription", () => {
  it("Can use firebase...", async () => {
    const url = "https://serverless-mesh-brianm.firebaseio.com";

    console.log("Connecting to firebase app");
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: url,
    });
    admin.database.enableLogging(true);

    const adaNameRef = admin.database().ref("users/ada/name");
    await adaNameRef.set({ first: "Ada", last: "Lovelace" });

    expect(true).toBeTruthy();
  });
});

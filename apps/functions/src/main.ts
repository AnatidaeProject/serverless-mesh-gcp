import * as functions from "firebase-functions";

export const helloWorld = functions.https.onRequest((request, response) => {
    response.send("✨ I am a happy service ✨");
});

## Run the local playground

The public npm release is **`0.1.0-alpha.4`**, a developer preview. See [release status](/docs/status/) for the quality gates still open.

Use **Node.js 24** on macOS or Linux. Open a terminal and run:

```sh
npx --yes ontave@0.1.0-alpha.4 playground --install
```

The explicit `--install` flag permits downloading the optional PostgreSQL playground tooling into an isolated temporary directory when it is not already installed. Open the localhost URL printed in the terminal. No Docker, database account or model key is required.

This is the real installed Ontave SDK with a temporary PostgreSQL database and a separate restricted runtime role. The sample adapter accepts only the supplied fictional messages. It makes no provider calls and is not an accuracy demonstration.

## Try the complete flow

1. Choose **An unexpected inspection** or **A payment claim**.
2. Interpret the message. The source is preserved; the proposed concept has not been activated.
3. Check the proposed change. An authored fixture suite checks the earlier Person contract, the new fields and the expected relationships.
4. Approve the model change. The source is reprocessed, and the new interpretation waits for review.
5. Inspect the source, confirm the displayed identity links and accept the interpretation. The generic interface adopts the new contract and reads the accepted record without rebuilding the application.

You can decline the model proposal or reject the interpretation instead. Neither creates the new accepted record. A payment claim remains `reported` after acceptance; the example supplies no independent confirmation.

Expand **Inspect the SDK operations and result** to see the bound source, evaluation, review bundle and actual record envelope.

## Reset and stop

Reset starts a fresh fictional workspace. This playground is a local learning tool, not a hosted database or a place to keep business records. Press **Ctrl+C** in the terminal to stop the server and remove its temporary database and optional temporary tooling.

The server binds only to `127.0.0.1`. To choose another port:

```sh
npx --yes ontave@0.1.0-alpha.4 playground --install --port 4321
```

The tested development environments are macOS arm64 and Linux x64. Other architectures and Windows are not yet qualified for this playground. A free localhost port, writable temporary directory and npm access for the first installation are required. The installation uses the platform-specific PostgreSQL binary.

## Browser sandbox

[Explore the browser sandbox](/playground/) without installing anything. It replays fictional reference runs produced by the real SDK/PostgreSQL harness. Its controls operate on those recorded runs; it does not run PostgreSQL or call a model in your browser.

## Use your own messages

For arbitrary input, install the [server package](/docs/installation/) and follow the [Node.js integration guide](/docs/node/). Configure your own dedicated PostgreSQL database, authentication and explicit model adapter. Your application remains responsible for review policy and user interfaces.

[Give developer-preview feedback](https://github.com/smileplis/ontave/issues/new?template=developer-preview.yml). Tell us where setup or review takes too much effort, which workflow you tried, and whether you would use Ontave again. Include fictional or redacted reproductions only.

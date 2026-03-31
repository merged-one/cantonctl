# Set Up Local Development

Start a local Canton development environment with hot-reload for rapid iteration.

**Difficulty:** Beginner
**Time:** 2 minutes
**Prerequisites:** Node.js 18+, dpm or daml CLI, an existing cantonctl project

## Steps

### 1. Verify your project has a config file

<!-- doctest:begin -->
```bash
cat cantonctl.yaml | head -5
```
<!-- doctest:expect:stdout "version:" -->
<!-- doctest:end -->

If you don't have a `cantonctl.yaml`, create a project first: `cantonctl init my-app`

### 2. Start the development server

<!-- doctest:begin -->
```bash
cantonctl dev
```
<!-- doctest:expect:stdout "Canton sandbox is ready" -->
<!-- doctest:end -->

The dev server:
1. Detects your SDK (`dpm` or `daml`)
2. Starts a Canton sandbox on `localhost:5001`
3. Starts the JSON Ledger API on `localhost:7575`
4. Provisions all parties defined in `cantonctl.yaml`
5. Watches `daml/` for file changes

### 3. Verify the sandbox is running

In a separate terminal, check the Ledger API:

```bash
curl -s http://localhost:7575/v2/version
```

### 4. Make a change and see hot-reload

Edit any `.daml` file in the `daml/` directory and save. The dev server will:
1. Detect the change (with 300ms debounce)
2. Rebuild the Daml project
3. Upload the new DAR to the sandbox
4. Report success or compilation errors

### 5. Stop the server

Press `Ctrl+C` or `q` to gracefully shut down. The sandbox process is killed and all resources are cleaned up.

## Custom Ports

```bash
cantonctl dev --port 6001 --json-api-port 8575
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Port in use" (E3002) | Kill the process on that port: `lsof -i :5001` then `kill <PID>` |
| "SDK not installed" (E2001) | Install dpm: https://www.digitalasset.com/developers |
| "Health timeout" (E3003) | Check system resources and port availability |
| Hot-reload not triggering | Ensure you're editing `.daml` files (not `.yaml` or other files) |

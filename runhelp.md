# Run the project

## 1) Open the project folder
Open a terminal in the project root:

```bash
cd "C:\Users\HP\Downloads\SDP"
```

## 2) Install dependencies
Run:

```bash
npm install
```

## 3) Start the app
Run:

```bash
npm start
```

## 4) Open the app in a browser
After the server starts, open:

```text
http://127.0.0.1:49321/
```

## Alternative startup command
If you want to force the same port:

```bash
PORT=49321 npm start
```

## Troubleshooting
- If you see `EADDRINUSE`, another app is already using port 49321. Stop that process or change the port.
- If you get a missing dependency error, run `npm install` first.
- If the server does not start, verify you are in the project folder and that Node.js is installed.

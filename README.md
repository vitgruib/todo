# Todo AI Extension

A smart todo list extension for Chrome/Edge with drag-and-drop support and a Gemini-backed AI companion.

## Prerequisites

**Node.js is required** to build this project.
1.  Download and install Node.js from [nodejs.org](https://nodejs.org/).
2.  Verify installation by running `node -v` and `npm -v` in your terminal.

## Setup

1.  Open your terminal in this directory.
2.  Install dependencies:
    ```bash
    npm install
    ```

## Development

To start the development server (for web view):
```bash
npm run dev
```

## AI Backend (Gemini Proxy)

The extension uses a local backend proxy so your Gemini API key stays server-side.

1. Create `server/.env`.
2. Add:
   ```env
   GEMINI_API_KEY=YOUR_KEY
   GEMINI_MODEL=gemma-3-12b-it
   PORT=8787
   ```
3. Start proxy:
   ```bash
   npm run proxy
   ```
4. Keep the proxy running at `http://localhost:8787`.

## Building for Chrome

1.  Build the project:
    ```bash
    npm run build
    ```
    This will create a `dist` folder.

2.  Open Chrome and go to `chrome://extensions`.
3.  Enable **Developer mode** (top right).
4.  Click **Load unpacked**.
5.  Select the `dist` folder in this project directory.

## Building for Microsoft Edge

1.  Build the project (if not already done):
    ```bash
    npm run build
    ```
2.  Open Edge and go to `edge://extensions`.
3.  Enable **Developer mode** (toggle in the sidebar or bottom left).
4.  Click **Load unpacked**.
5.  Select the `dist` folder in this project directory.

## Features

-   **Add Todos**: Title and optional deadline.
-   **Sub-steps**: Break down tasks into smaller steps.
-   **Drag and Drop**: Reorder your priorities.
-   **Persistence**: Data is saved automatically.
-   **Gemini AI Chat**: Companion chat powered by backend Gemini proxy.
-   **Dark Mode UI**: Clean, modern aesthetic.

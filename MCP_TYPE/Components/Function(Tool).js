const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// your existing file, unchanged
const {
    runAiMode,
    executeCode,
    resetBrowser,
    fetchScreenshot,
    openLiveBrowser,
    scrapePage,
    cleanScrapedData,
    exportToSheets,
    getSheetsList,
    readSheetsData
} = require("./functions");

const server = new McpServer({ name: "playwright-automation", version: "1.0.0" });

// helper: wrap a plain JS return value into MCP's content-block format
function textResult(value) {
    return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

server.registerTool(
    "runAiMode",
    {
        description: "Translate a natural language browser command into Playwright JS code.",
        inputSchema: { query: z.string().describe("natural language browser request") }
    },
    async ({ query }) => {
        try {
            const code = await runAiMode(query);
            return textResult({ code });
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "executeCode",
    {
        description: "Execute generated or edited Playwright JS automation code on the active browser page.",
        inputSchema: { code: z.string().describe("async Playwright JS code") }
    },
    async ({ code }) => {
        try {
            return textResult(await executeCode(code));
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "resetBrowser",
    {
        description: "Launch a fresh, clean browser window or clear session cookies/history.",
        inputSchema: { channel: z.enum(["chromium", "chrome", "msedge"]) }
    },
    async ({ channel }) => {
        try {
            return textResult(await resetBrowser(channel));
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "fetchScreenshot",
    { description: "Retrieve a real-time visual snapshot of the active page.", inputSchema: {} },
    async () => {
        try {
            const res = await fetchScreenshot();
            // send it as an actual image block, not just text — the LLM can "see" it
            if (res.screenshot) {
                return { content: [{ type: "image", data: res.screenshot, mimeType: "image/png" }] };
            }
            return textResult(res);
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "openLiveBrowser",
    { description: "Force-kill zombie browser processes and launch a fresh live browser.", inputSchema: {} },
    async () => {
        try {
            return textResult(await openLiveBrowser());
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "scrapePage",
    { description: "Extract raw structured DOM elements, widgets, headers, and schemas from the active page.", inputSchema: {} },
    async () => {
        try {
            return textResult(await scrapePage());
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "cleanScrapedData",
    {
        description: "Normalize, filter, and extract a clean list of products/prices from raw scraped data.",
        inputSchema: {
            scrapedData: z.record(z.any()).describe("raw scraped DOM JSON"),
            commands: z.array(z.any()).optional().describe("optional past execution trace")
        }
    },
    async ({ scrapedData, commands }) => {
        try {
            return textResult(await cleanScrapedData(scrapedData, commands ?? []));
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "exportToSheets",
    {
        description: "Save structured clean product listings into a specific tab of the connected Google Sheet.",
        inputSchema: { sheetName: z.string(), cleanData: z.record(z.any()) }
    },
    async ({ sheetName, cleanData }) => {
        try {
            return textResult(await exportToSheets(sheetName, cleanData));
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "getSheetsList",
    { description: "Fetch a list of all existing tab names inside the connected Google Sheet.", inputSchema: {} },
    async () => {
        try {
            return textResult(await getSheetsList());
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

server.registerTool(
    "readSheetsData",
    {
        description: "Pull existing records and data rows from Google Sheets to use as context.",
        inputSchema: { sheetNames: z.array(z.string()) }
    },
    async ({ sheetNames }) => {
        try {
            return textResult(await readSheetsData(sheetNames));
        } catch (err) {
            return { content: [{ type: "text", text: err.message }], isError: true };
        }
    }
);

const transport = new StdioServerTransport();
server.connect(transport);
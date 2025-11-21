import { MCPServer } from "mcp-framework";
import { initializeCatalogs } from "./utils/astronomy.js";
// The MCP framework will automatically discover and register our tools

await initializeCatalogs();
const server = new MCPServer();

server.start();
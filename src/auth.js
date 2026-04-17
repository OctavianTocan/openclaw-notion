"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotionApiKey = getNotionApiKey;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
function getNotionApiKey() {
    const keyPath = path_1.default.join(os_1.default.homedir(), '.config', 'notion', 'api_key');
    try {
        return fs_1.default.readFileSync(keyPath, 'utf8').trim();
    }
    catch (error) {
        throw new Error(`Failed to read Notion API key from ${keyPath}: ${error.message}`);
    }
}
//# sourceMappingURL=auth.js.map
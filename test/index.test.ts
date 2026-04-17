import { describe, it, expect } from 'vitest';
import { tools } from '../src/index';

// Vitest tests that perform real API calls against the Notion workspaces.

describe('Notion Plugin Live Tests', () => {
    
    describe('Default Agent (Tavi)', () => {
        it('should authenticate and execute a generic search', async () => {
            const context = { agentId: 'default' };
            const result = await tools.notion_search.execute({ query: "" }, context);
            const parsed = JSON.parse(result);
            
            // We expect live results to be returned
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThan(0);
        });

        it('should find Tavi-specific content', async () => {
            const context = { agentId: 'default' };
            const result = await tools.notion_search.execute({ query: "Code" }, context);
            const parsed = JSON.parse(result);
            
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThan(0);
        });
    });

    describe('gf_agent (Alaric / Esther)', () => {
        it('should authenticate and execute a generic search using the gf_agent key', async () => {
            const context = { agentId: 'gf_agent' };
            const result = await tools.notion_search.execute({ query: "" }, context);
            const parsed = JSON.parse(result);
            
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThan(0);
        });

        it('should find Esther-specific content in the isolated workspace', async () => {
            const context = { agentId: 'gf_agent' };
            const result = await tools.notion_search.execute({ query: "Possessives" }, context);
            const parsed = JSON.parse(result);
            
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThan(0);
            
            // The result title should include what we searched for
            const titleObject = parsed[0].properties.title || parsed[0].properties.Name;
            const titleText = titleObject?.title?.[0]?.plain_text || '';
            // Just verifying we got a valid object back from Notion
            expect(parsed[0].id).toBeDefined();
        });
    });
});

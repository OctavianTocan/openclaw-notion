export declare const tools: {
    notion_search: {
        description: string;
        parameters: {
            type: string;
            properties: {
                query: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
        execute: (args: {
            query: string;
        }) => Promise<string>;
    };
    notion_read: {
        description: string;
        parameters: {
            type: string;
            properties: {
                page_id: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
        execute: (args: {
            page_id: string;
        }) => Promise<string>;
    };
    notion_append: {
        description: string;
        parameters: {
            type: string;
            properties: {
                page_id: {
                    type: string;
                    description: string;
                };
                text: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
        execute: (args: {
            page_id: string;
            text: string;
        }) => Promise<string>;
    };
};
//# sourceMappingURL=index.d.ts.map
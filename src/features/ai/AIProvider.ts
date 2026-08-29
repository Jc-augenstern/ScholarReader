import { aiGateway } from "../../platform/tauri/aiGateway";

export interface AIProvider {
  explain(text: string, context?: string): Promise<string>;
  translate(text: string, targetLanguage: string): Promise<string>;
  summarize(text: string): Promise<string>;
  testConnection(): Promise<boolean>;
}

export class RustAIProvider implements AIProvider {
  constructor(readonly requestId: string) {}

  async explain(text: string, context?: string): Promise<string> {
    return (await aiGateway.run(this.requestId, "explain", text, context)).content;
  }

  async translate(text: string, targetLanguage: string): Promise<string> {
    return (await aiGateway.run(this.requestId, "translate", text, undefined, targetLanguage)).content;
  }

  async summarize(text: string): Promise<string> {
    return (await aiGateway.run(this.requestId, "summarize", text)).content;
  }

  testConnection(): Promise<boolean> {
    return aiGateway.testConnection();
  }
}

/**
 * WebMCP tool registry.
 *
 * Registers tools with navigator.modelContext (WebMCP-native path)
 * when available, and always exposes a window.__OPTCG_LAB__ fallback
 * for development/debug.
 *
 * Each tool has:
 *   - name, title, description
 *   - inputSchema (JSON Schema)
 *   - readOnlyHint, destructiveHint
 *   - execute function
 */

export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  execute(input: I): Promise<O>;
}

export interface AuditEntry {
  tool: string;
  input: unknown;
  output: unknown;
  timestamp: number;
  durationMs: number;
}

class WebMcpRegistry {
  private tools = new Map<string, ToolDef>();
  private _auditLog: AuditEntry[] = [];
  private _enabled = true;

  register<I, O>(tool: ToolDef<I, O>): void {
    this.tools.set(tool.name, tool as ToolDef);

    // WebMCP-native registration
    if ('modelContext' in navigator) {
      try {
        (navigator as any).modelContext.registerTool({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: !!tool.readOnlyHint,
          },
          execute: async (input: I) => {
            return await this.call(tool.name, input);
          },
        });
      } catch (e) {
        console.warn(`WebMCP registration failed for ${tool.name}:`, e);
      }
    }

    // Dev/debug fallback — always available
    (window as any).__OPTCG_LAB__ = {
      listTools: () => this.list(),
      callTool: (name: string, input: unknown) => this.call(name, input),
      getAuditLog: () => this._auditLog,
      isEnabled: () => this._enabled,
      setEnabled: (v: boolean) => { this._enabled = v; },
    };
  }

  list(): Array<{
    name: string;
    title?: string;
    description: string;
    inputSchema: object;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  }> {
    return [...this.tools.values()].map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      readOnlyHint: t.readOnlyHint,
      destructiveHint: t.destructiveHint,
    }));
  }

  async call(name: string, input: unknown): Promise<unknown> {
    if (!this._enabled) {
      throw new Error('WebMCP tools are disabled by user');
    }

    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    const start = performance.now();
    try {
      const output = await tool.execute(input);
      this._auditLog.push({
        tool: name,
        input,
        output,
        timestamp: Date.now(),
        durationMs: performance.now() - start,
      });
      return output;
    } catch (err: any) {
      this._auditLog.push({
        tool: name,
        input,
        output: { error: err.message },
        timestamp: Date.now(),
        durationMs: performance.now() - start,
      });
      throw err;
    }
  }

  get auditLog(): AuditEntry[] {
    return this._auditLog;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
  }

  get toolCount(): number {
    return this.tools.size;
  }

  hasWebMcpSupport(): boolean {
    return 'modelContext' in navigator;
  }
}

export const registry = new WebMcpRegistry();

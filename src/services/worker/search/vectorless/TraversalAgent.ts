export type LlmFn = (prompt: string) => Promise<string>;

export interface TraversalSelection {
  days?: string[];
  ids?: number[];
}

export function parseTraversalResponse(text: string): TraversalSelection {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const braced = candidate.match(/\{[\s\S]*\}/);
  if (!braced) throw new Error('No JSON object in LLM response');
  const parsed = JSON.parse(braced[0]);
  const result: TraversalSelection = {};
  if (Array.isArray(parsed.days)) result.days = parsed.days.map(String);
  if (Array.isArray(parsed.ids)) result.ids = parsed.ids.map(Number).filter(Number.isFinite);
  return result;
}

export class TraversalAgent {
  constructor(private llm: LlmFn) {}

  async selectDays(query: string, dayIndexText: string, maxDays: number): Promise<string[]> {
    const prompt = [
      `You are walking a memory index to answer: "${query}"`,
      `Each line below is one day of recorded work. Pick the days most likely to contain relevant observations — you may pick days far apart (the answer often spans multiple days and sessions).`,
      ``,
      dayIndexText,
      ``,
      `Respond with ONLY a JSON object: {"days": ["YYYY-MM-DD", ...]} — at most ${maxDays} days.`,
    ].join('\n');
    const response = await this.llm(prompt);
    return (parseTraversalResponse(response).days ?? []).slice(0, maxDays);
  }

  async selectObservations(query: string, obsIndexText: string, limit: number): Promise<number[]> {
    const prompt = [
      `You are selecting memory observations to answer: "${query}"`,
      `Each line below is one observation: [id] date type (source) title.`,
      ``,
      obsIndexText,
      ``,
      `Respond with ONLY a JSON object: {"ids": [<number>, ...]} — the most relevant ids, best first, at most ${limit}.`,
    ].join('\n');
    const response = await this.llm(prompt);
    return (parseTraversalResponse(response).ids ?? []).slice(0, limit);
  }
}

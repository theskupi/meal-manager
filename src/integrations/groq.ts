import Groq from 'groq-sdk';
import { config } from '../config';

export interface ParsedIntent {
  intent: 'add_pantry' | 'query_schedule' | 'skip_meal' | 'query_pantry' | 'unknown';
  params: Record<string, unknown>;
}

const REPAIR_MODEL = 'llama-3.3-70b-versatile';
const INTENT_MODEL = 'llama-3.3-70b-versatile';

const client = new Groq({ apiKey: config.groq.apiKey });

export async function repairJson(rawText: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: REPAIR_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are a JSON repair assistant. The user will provide broken or incomplete JSON. ' +
          'Return ONLY the corrected, valid JSON — no explanation, no markdown, no code fences.',
      },
      {
        role: 'user',
        content: `Fix this JSON:\n\n${rawText}`,
      },
    ],
  });
  return completion.choices[0]?.message?.content ?? rawText;
}

export async function parseIntent(text: string): Promise<ParsedIntent> {
  const completion = await client.chat.completions.create({
    model: INTENT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are an intent parser for a meal planning kitchen assistant. ' +
          'Given a user message, return a JSON object with "intent" and "params".\n\n' +
          'Intents: add_pantry | query_schedule | skip_meal | query_pantry | unknown\n\n' +
          'Return ONLY valid JSON, no explanation.',
      },
      { role: 'user', content: text },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{"intent":"unknown","params":{}}';

  try {
    const parsed = JSON.parse(raw) as ParsedIntent;
    return parsed;
  } catch {
    return { intent: 'unknown', params: {} };
  }
}

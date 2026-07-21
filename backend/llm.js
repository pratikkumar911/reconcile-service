const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const LLM_API_KEY = process.env.LLM_API_KEY || '';
const MODEL_PROVIDER = 'gemini';
const MODEL_NAME = 'gemini-2.5-flash';
const TIMEOUT_S = 15;

const SYSTEM_PROMPT = [
  'You are a finance-operations assistant helping a store owner understand',
  'reconciliation discrepancies between their orders and payment processor.',
  'Reply ONLY in JSON with keys: summary (1 sentence, plain English),',
  'likely_cause (1-2 sentences), suggested_action (1 short imperative sentence).',
  'Keep it concrete, avoid jargon, do not invent numbers.',
].join(' ');

function fallback(reason) {
  return {
    summary: 'Explanation could not be generated.',
    likely_cause: `LLM service issue: ${reason}`,
    suggested_action: 'Please try again in a moment.',
  };
}

function buildUserPrompt(discrepancy) {
  const payload = {
    type: discrepancy?.type,
    order_id: discrepancy?.order_id,
    payment_id: discrepancy?.payment_id,
    expected_amount: discrepancy?.expected_amount,
    actual_amount: discrepancy?.actual_amount,
    currency: discrepancy?.currency,
    money_at_risk: discrepancy?.money_at_risk,
    details: discrepancy?.details_json || {},
  };

  return [
    'Explain this reconciliation discrepancy for a non-technical store owner.',
    'Return strictly JSON with the required keys.\n\n',
    'Discrepancy:\n',
    JSON.stringify(payload, null, 2),
  ].join('');
}

async function explainDiscrepancy(discrepancy) {
  if (!LLM_API_KEY) {
    return fallback('LLM_API_KEY not configured');
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${LLM_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildUserPrompt(discrepancy) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const stripped = String(text).trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Malformed LLM JSON response');
    }

    const parsed = JSON.parse(match[0]);
    return {
      summary: String(parsed.summary || '').slice(0, 400),
      likely_cause: String(parsed.likely_cause || '').slice(0, 600),
      suggested_action: String(parsed.suggested_action || '').slice(0, 400),
    };
  } catch (error) {
    return fallback(error.message || 'LLM unavailable');
  }
}

module.exports = {
  explainDiscrepancy,
  buildUserPrompt,
  fallback,
};
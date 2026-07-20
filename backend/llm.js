const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const LLM_API_KEY = process.env.LLM_API_KEY || '';
const MODEL_PROVIDER = 'openai';
const MODEL_NAME = 'gpt-4.1-mini';
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(discrepancy) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with ${response.status}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
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

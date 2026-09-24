// Exposes the second AI service's official SDK to the single-file page as window.AnthropicSDK (used by src/11s_ai.js).
import Anthropic from '@anthropic-ai/sdk';
window.AnthropicSDK = Anthropic;

// Exposes the second AI service's official SDK to the single-file page as window.AnthropicSDK (ui/boot hands it to src/ai/providers.js).
import Anthropic from '@anthropic-ai/sdk';
window.AnthropicSDK = Anthropic;

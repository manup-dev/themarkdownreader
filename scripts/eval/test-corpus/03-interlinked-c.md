# Transformers

## The Attention Revolution

The Transformer architecture (Vaswani et al., 2017, "Attention Is All You Need") replaced recurrent processing with **self-attention**, enabling parallel computation and better long-range dependencies.

## Self-Attention Mechanism

For each token, compute attention weights over all other tokens:

1. Create Query (Q), Key (K), Value (V) matrices from input
2. Attention(Q, K, V) = softmax(QK^T / √d_k) · V
3. Multi-head attention: run h attention heads in parallel, concatenate

This is what makes [Neural Networks](./03-interlinked-b.md) so powerful for NLP tasks.

## Architecture

```
Input Embeddings + Positional Encoding
         ↓
┌──────────────────────┐
│   Multi-Head          │ ×N
│   Self-Attention      │
│         ↓             │
│   Feed-Forward        │
│   Network             │
└──────────────────────┘
         ↓
Output (for encoder) or next token prediction (for decoder)
```

## Key Models

| Model | Year | Parameters | Key Innovation |
|-------|------|-----------|----------------|
| BERT | 2018 | 340M | Bidirectional pre-training |
| GPT-2 | 2019 | 1.5B | Autoregressive generation |
| T5 | 2019 | 11B | Text-to-text framework |
| GPT-3 | 2020 | 175B | Few-shot learning |
| GPT-4 | 2023 | ~1.8T* | Multimodal reasoning |

*Estimated, not officially disclosed.

## Connection to ML Fundamentals

Transformers are a type of [supervised learning](./03-interlinked-a.md#supervised-learning) model, typically trained on massive text corpora using self-supervised objectives (next token prediction or masked language modeling).

## Impact

Transformers power:
- Large Language Models (GPT, Claude, Gemini)
- Machine translation
- Code generation (Copilot, Codex)
- Image generation (Vision Transformers, DALL-E)
- Protein folding (AlphaFold)

# Neural Networks

## Overview

Neural networks are computing systems inspired by biological neural networks. They form the foundation of [deep learning](./03-interlinked-a.md#supervised-learning) and modern AI.

## Architecture

### Perceptron

The simplest neural network: a single neuron with weighted inputs.

```
Input₁ ──w₁──→ ┌──────┐
Input₂ ──w₂──→ │ Σ(wx)+b│──→ activation(z) ──→ Output
Input₃ ──w₃──→ └──────┘
```

### Multi-Layer Perceptron (MLP)

- **Input Layer**: Receives features
- **Hidden Layers**: Learn representations
- **Output Layer**: Produces predictions

### Activation Functions

| Function | Range | Use Case |
|----------|-------|----------|
| ReLU | [0, ∞) | Hidden layers (default) |
| Sigmoid | (0, 1) | Binary classification |
| Tanh | (-1, 1) | Hidden layers |
| Softmax | (0, 1) | Multi-class output |

## Training

Training uses **backpropagation** + **gradient descent**:

1. Forward pass: compute predictions
2. Compute loss (MSE, Cross-Entropy)
3. Backward pass: compute gradients via chain rule
4. Update weights: w ← w - η·∇L

See [Transformers](./03-interlinked-c.md) for attention-based architectures that replaced RNNs.

## Common Architectures

- **CNNs**: Convolutional layers for image processing
- **RNNs**: Recurrent connections for sequential data
- **[[Transformers]]**: Self-attention for parallel sequence processing
- **GANs**: Generator + Discriminator for generative tasks

# Machine Learning Fundamentals

## What is Machine Learning?

Machine Learning (ML) is a subset of artificial intelligence that enables systems to learn from data without being explicitly programmed. See [Neural Networks](./03-interlinked-b.md) for deep learning approaches.

## Types of Learning

### Supervised Learning

Given labeled training data (input → output pairs), the model learns a mapping function.

- **Classification**: Predict discrete labels (spam/not spam)
- **Regression**: Predict continuous values (house prices)

Common algorithms: Linear Regression, Decision Trees, Random Forests, [[Support Vector Machines]].

### Unsupervised Learning

Discover patterns in unlabeled data.

- **Clustering**: Group similar data (K-Means, DBSCAN)
- **Dimensionality Reduction**: Compress features (PCA, t-SNE, UMAP)

### Reinforcement Learning

An agent learns by interacting with an environment, receiving rewards for good actions. See [Transformers](./03-interlinked-c.md) for how attention mechanisms changed RL.

## Evaluation Metrics

| Task | Metric | Formula |
|------|--------|---------|
| Classification | Accuracy | (TP+TN)/(TP+TN+FP+FN) |
| Classification | F1 Score | 2·(P·R)/(P+R) |
| Regression | RMSE | √(Σ(y-ŷ)²/n) |
| Regression | R² | 1 - SS_res/SS_tot |

## Prerequisites

This document assumes familiarity with:
- Linear algebra (vectors, matrices)
- Probability and statistics
- Basic calculus (gradients)
- Python programming

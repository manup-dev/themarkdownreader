# Distributed Systems: Consensus Algorithms

## Overview

Consensus algorithms solve the fundamental problem of getting multiple nodes in a distributed system to agree on a single value, even when some nodes may fail. This is formalized as the **Byzantine Generals Problem** (Lamport et al., 1982).

## Raft Consensus Algorithm

Raft (Ongaro & Ousterhout, 2014) was designed as an understandable alternative to Paxos. It decomposes consensus into three sub-problems:

### Leader Election

1. Nodes start as **followers**
2. If no heartbeat received within election timeout → become **candidate**
3. Request votes from other nodes via `RequestVote` RPC
4. Majority vote → become **leader**
5. Leaders send periodic heartbeats to maintain authority

```
Follower ──timeout──→ Candidate ──majority──→ Leader
    ↑                     |                      |
    └─── discovers leader ←── higher term ───────┘
```

### Log Replication

The leader accepts client requests, appends entries to its log, and replicates via `AppendEntries` RPC:

| Term | Index | Command |
|------|-------|---------|
| 1    | 1     | SET x=1 |
| 1    | 2     | SET y=2 |
| 2    | 3     | SET x=3 |

Entries are committed when replicated to a majority of servers.

### Safety Properties

- **Election Safety**: At most one leader per term
- **Leader Append-Only**: Leaders never overwrite or delete entries
- **Log Matching**: If two logs have same index+term, all preceding entries are identical
- **Leader Completeness**: Committed entries appear in all future leaders' logs
- **State Machine Safety**: All nodes apply the same log entries in the same order

## Comparison with Paxos

| Property | Raft | Paxos |
|----------|------|-------|
| Understandability | High | Low |
| Leader-based | Yes | Optional |
| Membership changes | Built-in | Separate |
| Industry adoption | etcd, CockroachDB | Chubby, Spanner |

## Byzantine Fault Tolerance (BFT)

Unlike Raft (which assumes crash faults only), BFT protocols handle **arbitrary/malicious behavior**:

- **PBFT** (Castro & Liskov, 1999): Tolerates f faults with 3f+1 nodes. O(n²) message complexity.
- **Tendermint**: BFT for blockchain. Combines PBFT-like rounds with Proof-of-Stake.
- **HotStuff** (Yin et al., 2019): Linear message complexity. Used in Meta's Diem/Libra.

## CAP Theorem Implications

Brewer's CAP theorem states you can have at most 2 of 3:
- **Consistency**: All nodes see the same data simultaneously
- **Availability**: Every request receives a response
- **Partition Tolerance**: System continues despite network failures

Consensus algorithms choose **CP** (consistency + partition tolerance), sacrificing availability during partitions.

## References

1. Lamport, L., Shostak, R., & Pease, M. (1982). "The Byzantine Generals Problem."
2. Ongaro, D., & Ousterhout, J. (2014). "In Search of an Understandable Consensus Algorithm (Raft)."
3. Castro, M., & Liskov, B. (1999). "Practical Byzantine Fault Tolerance."
4. Yin, M., et al. (2019). "HotStuff: BFT Consensus with Linearity and Responsiveness."

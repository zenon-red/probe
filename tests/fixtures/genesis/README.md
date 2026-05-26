# Genesis golden hash fixtures

Copied from [nexus/stdb/fixtures/genesis](https://github.com/zenon-red/nexus/tree/main/stdb/fixtures/genesis) so Probe CI does not depend on a sibling checkout.

| File                              | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `zenon-red.manifest.json`         | Production org genesis (`zenon-red`, full dispatch route map)           |
| `zenon-red.expected-hash.txt`     | Golden hash for production manifest                                     |
| `zenon-red-lab.manifest.json`     | Lab org genesis (`zenon-red-lab`, same route map, lab endpoints/marker) |
| `zenon-red-lab.expected-hash.txt` | Golden hash for lab manifest                                            |

Keep in sync with Nexus when vectors change (algorithm: RFC8785 JCS + SHA-256 hex).

From the monorepo, after editing `nexus/orgs/*/genesis.json`:

```bash
nexus/stdb/scripts/genesis-fixtures.sh --write
```

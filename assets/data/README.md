# Airline dataset

`airlines.json` is generated from the official OpenFlights airline CSV, not maintained as a handwritten airline map.

- Source: https://openflights.org/data.php#airline
- Repository: https://github.com/jpatokal/openflights
- License: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) and the linked [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).
- The normalized snapshot is made available under ODbL 1.0. This applies to the dataset, separately from application source code.
- Transformations: keep rows whose source `Active` flag is `Y`, validate IATA/ICAO syntax, retain the original airline name and remove exact duplicate rows. Missing codes stay `null`.
- The snapshot records its upstream commit, original CSV checksum, download URL and retrieval time in `source`.

Refresh with `npm run data:update:airlines`. It downloads a revision-pinned official CSV and only replaces the existing file after parsing and validation succeed. Builds and normal application requests do not download the dataset or consume AirLabs requests.

OpenFlights describes its GitHub data as a sporadically updated snapshot. Its `Active` flag is a dataset field, not a guarantee that an airline currently operates. Unknown or ambiguous codes are not guessed, and callsign-derived matches are identified as inferred. Names retain the source language rather than a handwritten translation table.

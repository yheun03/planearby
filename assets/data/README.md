# Airline dataset

`airlines.json` is generated from the official OpenFlights airline CSV, not maintained as a handwritten airline map.

- Source: https://openflights.org/data.php#airline
- Repository: https://github.com/jpatokal/openflights
- License: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) and the linked [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).
- The normalized snapshot is made available under ODbL 1.0. This applies to the dataset, separately from application source code.
- Transformations: keep rows whose source `Active` flag is `Y`, validate IATA/ICAO syntax, retain the original airline name and remove exact duplicate rows. Missing codes stay `null`.
- The snapshot records its upstream commit, original CSV checksum, download URL and retrieval time in `source`.

Refresh with `npm run data:update:airlines`. It downloads the revision-pinned official CSV and the domestic directory below, validates both responses before writing, and replaces each file through a temporary file. Builds and normal application requests do not download the datasets or call a name-lookup API.

OpenFlights describes its GitHub data as a sporadically updated snapshot. Its `Active` flag is a dataset field, not a guarantee that an airline currently operates. Unknown or ambiguous codes are not guessed, and callsign-derived matches are identified as inferred. Names retain the source language rather than a handwritten translation table.

## Domestic airline directory

`airlines-kr.json` is generated from the [Air Portal airline directory](https://www.airportal.go.kr/airline/airCompanyInfo.do), provided by the Ministry of Land, Infrastructure and Transport / Korea Civil Aviation Association.

- Endpoint: `POST https://www.airportal.go.kr/airline/searchAirline.do`, using the query recorded in `source.query`.
- Keep operating airlines in `Republic of Korea` and retain English/Korean names and valid IATA/ICAO codes. Reject incomplete pagination and invalid responses.
- Record source URLs, retrieval time, response checksum, filters and attribution. The snapshot contains factual airline names and codes; original website terms apply. No license is asserted for the original directory, and the OpenFlights license above does not describe this source.
- Prefer these records when resolving an airline. Remove conflicting OpenFlights records by IATA or ICAO identity before building the lookup, so historical code reuse cannot override the domestic directory. This also covers airlines absent from the OpenFlights snapshot without a handwritten exception map.

The dataset supplies Korean display names directly. Other interface languages retain source English names. Data updates use the same `npm run data:update:airlines` command; ordinary scans make no directory requests.

## Aircraft types

`planes.json` is generated from [OpenFlights aircraft data](https://openflights.org/data.php#plane) under the same ODbL 1.0 and Database Contents License terms. Refresh it with `npm run data:update:aircraft`.

The snapshot retains source names and valid ICAO designators for Airbus, Boeing and Bombardier models, including legacy Canadair CRJ/Challenger and Dash 8 types. GLEX is explicitly excluded. This is a model-family filter, not a claim about the current owner of each legacy product line. Types absent from the snapshot are excluded. Helicopters are absent from this allowlist, and the live ADS-B rotorcraft category `A7` is also rejected.

The source commit, CSV checksum and retrieval time are recorded in the snapshot. Aircraft names are not maintained as a handwritten map. Like the airline snapshot, this derived dataset is available under ODbL 1.0 separately from application source code.

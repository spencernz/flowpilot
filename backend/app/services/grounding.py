"""Server-owned source snapshots and citation validation."""

import re


def citation_ids(response, sources):
    identifiers = list(dict.fromkeys(re.findall(r"\[([Ss]\d+)\]", response)))
    allowed = {
        source["citation_id"] if isinstance(source, dict) else source.citation_id
        for source in sources
    }
    if any(identifier not in allowed for identifier in identifiers):
        raise ValueError("Response cites a source that was not retrieved.")
    return identifiers


def validate_grounding(output, sources):
    identifiers = citation_ids(output.suggested_response, sources)
    if set(output.citations) != set(identifiers):
        raise ValueError("Citation list must match source references in the response.")
    output.citations = identifiers
    output.human_verification_required = output.human_verification_required or not bool(
        identifiers
    )
    if not sources and "human verification" not in output.suggested_response.lower():
        output.suggested_response += "\n\nCompany policy could not be verified from relevant sources. Human verification is required before confirming any policy or eligibility."
    return output

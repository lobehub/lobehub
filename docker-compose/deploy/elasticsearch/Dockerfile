# Optional single-node Elasticsearch for LobeHub full-text search.
# Built by the `elasticsearch` service in ../docker-compose.yml; the version is
# passed from there so that `image` and the base image always match.
ARG ELASTICSEARCH_VERSION
FROM docker.elastic.co/elasticsearch/elasticsearch:${ELASTICSEARCH_VERSION}

# The LobeHub index mappings require the ICU analysis plugin.
RUN bin/elasticsearch-plugin install --batch analysis-icu

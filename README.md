Prelive

## GraphQL Examples

```bash
# Get playing status
curl -s http://localhost:5100/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ live_set { id is_playing } }"}' | jq .

# List tracks
curl -s http://localhost:5100/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ live_set { tracks { id name has_midi_input } } }"}' | jq .

# Song overview with clips
curl -s http://localhost:5100/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ live_set { id path is_playing tracks { id name clip_slots { id has_clip clip { id name length is_midi_clip } } } } }"}' | jq .
```

```
https://github.com/Ableton/maxdevtools
```

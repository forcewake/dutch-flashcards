B=http://localhost:8787; A=https://forcewake.github.io
j(){ curl -s "$@"; echo; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
R=$(curl -s -XPOST $B/v1/register); echo "register: $R"; T=$(echo $R | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
H="Authorization: Bearer $T"; NOW=$(date +%s%3N)
echo "progress empty: $(curl -s -H "$H" $B/v1/progress)"
echo "progress no token: $(code $B/v1/progress)  bad token: $(code -H 'Authorization: Bearer xx' $B/v1/progress)"
echo "import: $(curl -s -H "$H" -XPOST $B/v1/import -d "{\"changes\":{\"nl:het-huis\":{\"level\":2,\"due_at\":$NOW,\"seen\":3,\"wrong\":1,\"updated_at\":1000}}}" | head -c 300)"
echo "import again (idempotent): $(curl -s -H "$H" -XPOST $B/v1/import -d "{\"changes\":{\"nl:het-huis\":{\"level\":2,\"due_at\":$NOW,\"seen\":3,\"wrong\":1,\"updated_at\":1000}}}" | head -c 120)"
echo "sync newer: $(curl -s -H "$H" -XPOST $B/v1/sync -d "{\"changes\":[{\"card_id\":\"nl:het-huis\",\"level\":0,\"due_at\":$NOW,\"seen\":4,\"wrong\":2,\"updated_at\":2000},{\"card_id\":\"nl:de-kaas\",\"level\":4,\"due_at\":9999999999999,\"seen\":5,\"wrong\":0,\"updated_at\":2000}],\"events\":[{\"type\":\"session_start\",\"ts\":$((NOW-60000))},{\"type\":\"flip\",\"card_id\":\"nl:het-huis\",\"data\":{\"shown\":true},\"ts\":$((NOW-50000))},{\"type\":\"answer\",\"card_id\":\"nl:het-huis\",\"ok\":false,\"ts\":$((NOW-40000))},{\"type\":\"position\",\"card_id\":\"nl:de-kaas\",\"data\":{\"pos\":1,\"dir\":\"auto\"},\"ts\":$((NOW-30000))},{\"type\":\"answer\",\"card_id\":\"nl:de-kaas\",\"ok\":true,\"ts\":$((NOW-20000))},{\"type\":\"bogus\",\"ts\":1},{\"type\":\"flip\",\"card_id\":\"BAD ID\",\"ts\":1}]}")"
echo "sync older (must lose): $(curl -s -H "$H" -XPOST $B/v1/sync -d '{"changes":{"nl:het-huis":{"level":6,"seen":99,"updated_at":1500}}}' | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0)).progress["nl:het-huis"])')"
echo "sync bad json: $(code -H "$H" -XPOST $B/v1/sync -d '{x')"
echo "events: $(curl -s -H "$H" "$B/v1/events?limit=3&since=0")"
RT=$(curl -s -H "$H" -XPOST $B/v1/read-token | node -pe 'JSON.parse(require("fs").readFileSync(0)).readToken'); echo "read-token: $RT"
echo "read token on /v1/progress (should 401): $(code -H "Authorization: Bearer $RT" $B/v1/progress)"
echo "preflight allowed:"; curl -s -i -XOPTIONS -H "Origin: $A" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type' $B/v1/sync | grep -iE '^HTTP|access-control'
echo "preflight disallowed: $(code -XOPTIONS -H 'Origin: https://evil.example' $B/v1/sync)"; curl -s -i -XOPTIONS -H 'Origin: https://evil.example' $B/v1/sync | grep -ic access-control
echo "GET allowed origin ACAO: $(curl -s -i -H "Origin: $A" -H "$H" $B/v1/progress | grep -i allow-origin)"
echo "POST disallowed origin: $(code -XPOST -H 'Origin: https://evil.example' $B/v1/register)"
RT2=$(curl -s -H "$H" -XPOST $B/v1/read-token | node -pe 'JSON.parse(require("fs").readFileSync(0)).readToken')
RH="Authorization: Bearer $RT"; P(){ curl -s -o /dev/null -w "%{http_code}" -XPOST $B/mcp -H "Content-Type: application/json" -H "$1" -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'; }; echo "rotated: old read token $(P "$RH"), new $(P "Authorization: Bearer $RT2")"
echo "stats with read token: $(curl -s -H "Authorization: Bearer $RT2" $B/v1/stats | head -c 200)"
echo "events with read token (should 401): $(code -H "Authorization: Bearer $RT2" $B/v1/events)"
echo "dashboard:"; curl -s -i $B/dashboard | grep -iE '^HTTP|content-security|x-frame|content-type'
echo "404: $(code -H "$H" $B/v1/nope)"
echo "$T" > /tmp/T; echo "$RT2" > /tmp/RT

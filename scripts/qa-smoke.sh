#!/bin/bash
# AvoMessage Phase 12 smoke test: signup → verify → login → post → comment →
# like → follow → DM → message → notifications, over HTTP with curl + cookie jars.
# Usage: BASE=http://localhost:3100 bash scripts/qa-smoke.sh
set -u
BASE="${BASE:-http://localhost:3100}"
JAR_A=/tmp/smoke-a.txt; JAR_B=/tmp/smoke-b.txt
rm -f "$JAR_A" "$JAR_B"
PASS=0; FAIL=0

csrf() { # $1 = jar → prints csrf token
  grep -oP 'avo_csrf\s+\K\S+' "$1" | tail -1
}
check() { # $1 = description, $2 = expected status, $3 = actual status
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1 ($3)";
  else FAIL=$((FAIL+1)); echo "  FAIL $1: expected $2, got $3"; fi
}
# POST with CSRF double-submit. $1=jar $2=path $3=json → prints "status body"
api_post() {
  local jar="$1" path="$2" json="$3"
  local out status
  out=$(curl -s -b "$jar" -c "$jar" -X POST "$BASE$path" \
    -H 'Content-Type: application/json' -H "x-csrf-token: $(csrf "$jar")" \
    -d "$json" -w '\n%{http_code}')
  status=$(echo "$out" | tail -1); echo "$status $(echo "$out" | head -n -1)"
}
api_get() { # $1=jar $2=path
  local out status
  out=$(curl -s -b "$1" -c "$1" "$BASE$2" -w '\n%{http_code}')
  status=$(echo "$out" | tail -1); echo "$status $(echo "$out" | head -n -1)"
}
verify_token_for() { # $1 = "before" snapshot file → newest NEW verify-email token
  local before_file="$1" f
  for i in $(seq 1 20); do
    f=$(comm -13 <(sort "$before_file") <(ls storage/mail/*-verify-email.html 2>/dev/null | sort) | tail -1)
    if [ -n "$f" ]; then
      grep -oP '/verify-email\?token=\K[0-9a-f]{64}' "$f" | head -1
      return 0
    fi
    sleep 0.5
  done
  echo ""
}
mail_snapshot() { ls storage/mail/*-verify-email.html 2>/dev/null | sort > "$1"; }

echo "== 1. signup A =="
TS=$(date +%s)
EA="smokea_$TS@example.com"; EB="smokeb_$TS@example.com"
mail_snapshot /tmp/smoke-mail-before.txt
R=$(curl -s -b "$JAR_A" -c "$JAR_A" -X POST "$BASE/api/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke A\",\"username\":\"smokea_$TS\",\"email\":\"$EA\",\"password\":\"SmokePass123!\"}" -w '\n%{http_code}')
check "signup A" 201 "$(echo "$R" | tail -1)"
UA=$(echo "$R" | head -n -1 | grep -oP '"username":"\K[^"]+')
echo "== 2. verify A =="
TOK=$(verify_token_for /tmp/smoke-mail-before.txt)
mail_snapshot /tmp/smoke-mail-before.txt
if [ -z "$TOK" ]; then echo "  FAIL could not extract verify token"; FAIL=$((FAIL+1)); else
R=$(curl -s -b "$JAR_A" -c "$JAR_A" -X POST "$BASE/api/auth/verify-email" \
  -H 'Content-Type: application/json' -d "{\"token\":\"$TOK\"}" -w '\n%{http_code}')
check "verify A" 200 "$(echo "$R" | tail -1)"; fi

echo "== 3. login A =="
R=$(curl -s -b "$JAR_A" -c "$JAR_A" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EA\",\"password\":\"SmokePass123!\"}" -w '\n%{http_code}')
check "login A" 200 "$(echo "$R" | tail -1)"

echo "== 4. create post =="
R=$(api_post "$JAR_A" /api/posts '{"body":"Smoke test post — hello world","visibility":"PUBLIC"}')
check "create post" 201 "$(echo "$R" | cut -d' ' -f1)"
POST_ID=$(echo "$R" | cut -d' ' -f2- | grep -oP '"id":"\K[^"]+' | head -1)

echo "== 5. comment on post =="
R=$(api_post "$JAR_A" "/api/posts/$POST_ID/comments" '{"body":"First comment!"}')
check "create comment" 201 "$(echo "$R" | cut -d' ' -f1)"

echo "== 6. signup+verify+login B =="
R=$(curl -s -b "$JAR_B" -c "$JAR_B" -X POST "$BASE/api/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke B\",\"username\":\"smokeb_$TS\",\"email\":\"$EB\",\"password\":\"SmokePass123!\"}" -w '\n%{http_code}')
check "signup B" 201 "$(echo "$R" | tail -1)"
TOKB=$(verify_token_for /tmp/smoke-mail-before.txt)
R=$(curl -s -b "$JAR_B" -c "$JAR_B" -X POST "$BASE/api/auth/verify-email" \
  -H 'Content-Type: application/json' -d "{\"token\":\"$TOKB\"}" -w '\n%{http_code}')
check "verify B" 200 "$(echo "$R" | tail -1)"
R=$(curl -s -b "$JAR_B" -c "$JAR_B" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EB\",\"password\":\"SmokePass123!\"}" -w '\n%{http_code}')
check "login B" 200 "$(echo "$R" | tail -1)"

echo "== 7. B likes A's post =="
R=$(api_post "$JAR_B" "/api/posts/$POST_ID/like" '{}')
check "like post" 200 "$(echo "$R" | cut -d' ' -f1)"

echo "== 8. B follows A =="
R=$(api_post "$JAR_B" "/api/users/$UA/follow" '{}')
check "follow" 200 "$(echo "$R" | cut -d' ' -f1)"

echo "== 9. A sees LIKE + FOLLOW notifications =="
R=$(api_get "$JAR_A" "/api/notifications?unreadOnly=true")
check "notifications list" 200 "$(echo "$R" | cut -d' ' -f1)"
BODY=$(echo "$R" | cut -d' ' -f2-)
echo "$BODY" | grep -q '"type":"LIKE"' && check "LIKE notification present" 0 0 || check "LIKE notification present" 0 1
echo "$BODY" | grep -q '"type":"FOLLOW"' && check "FOLLOW notification present" 0 0 || check "FOLLOW notification present" 0 1

echo "== 10. DM: A creates conversation with B =="
BID=$(curl -s -b "$JAR_B" "$BASE/api/users/me" | grep -oP '"id":"\K[^"]+' | head -1)
R=$(api_post "$JAR_A" /api/conversations "{\"type\":\"DM\",\"userIds\":[\"$BID\"]}")
check "create DM" 201 "$(echo "$R" | cut -d' ' -f1)"
CONV=$(echo "$R" | cut -d' ' -f2- | grep -oP '"id":"\K[^"]+' | head -1)

echo "== 11. A sends message =="
R=$(api_post "$JAR_A" "/api/conversations/$CONV/messages" '{"body":"Hey B, smoke test DM"}')
check "send message" 201 "$(echo "$R" | cut -d' ' -f1)"
MSG_ID=$(echo "$R" | cut -d' ' -f2- | grep -oP '"id":"\K[^"]+' | head -1)

echo "== 12. B reads messages + conversation list =="
R=$(api_get "$JAR_B" "/api/conversations/$CONV/messages")
check "list messages" 200 "$(echo "$R" | cut -d' ' -f1)"
if [ -n "$MSG_ID" ]; then
  echo "$R" | grep -q "$MSG_ID" && check "message visible to B" 0 0 || check "message visible to B" 0 1
else
  check "message visible to B (MSG_ID empty)" 0 1
fi
R=$(api_post "$JAR_B" "/api/conversations/$CONV/read" '{}')
check "mark read" 200 "$(echo "$R" | cut -d' ' -f1)"

echo "== 13. B reacts to the message =="
R=$(api_post "$JAR_B" "/api/messages/$MSG_ID/reactions" '{"emoji":"👍"}')
check "toggle reaction" 200 "$(echo "$R" | cut -d' ' -f1)"

echo "== 14. mark notifications read =="
R=$(api_post "$JAR_A" "/api/notifications/read" '{}')
check "mark all read" 200 "$(echo "$R" | cut -d' ' -f1)"
R=$(api_get "$JAR_A" "/api/notifications?unreadOnly=true")
UNREAD=$(echo "$R" | cut -d' ' -f2- | grep -oP '"unreadCount":\K[0-9]+')
check "unreadCount is 0" 0 "$UNREAD"

echo ""
echo "SMOKE RESULT: $PASS passed, $FAIL failed"

# --- cleanup: remove the smoke users and everything they touched ---
node -e "
const { Client } = require('pg');
const emails = ['$EA', '$EB'];
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const ids = (await c.query('SELECT id FROM \"User\" WHERE email = ANY(\$1)', [emails])).rows.map(r => r.id);
  if (ids.length) {
    const convos = (await c.query('SELECT DISTINCT \"conversationId\" AS id FROM \"ConversationMember\" WHERE \"userId\" = ANY(\$1)', [ids])).rows.map(r => r.id);
    const msgs = (await c.query('SELECT id FROM \"Message\" WHERE \"senderId\" = ANY(\$1) OR \"conversationId\" = ANY(\$2)', [ids, convos])).rows.map(r => r.id);
    await c.query('DELETE FROM \"MessageReaction\" WHERE \"messageId\" = ANY(\$1)', [msgs]);
    await c.query('DELETE FROM \"Attachment\" WHERE \"messageId\" = ANY(\$1)', [msgs]);
    await c.query('DELETE FROM \"Message\" WHERE id = ANY(\$1)', [msgs]);
    await c.query('DELETE FROM \"ConversationMember\" WHERE \"conversationId\" = ANY(\$1)', [convos]);
    await c.query('DELETE FROM \"Conversation\" WHERE id = ANY(\$1)', [convos]);
    const posts = (await c.query('SELECT id FROM \"Post\" WHERE \"authorId\" = ANY(\$1)', [ids])).rows.map(r => r.id);
    await c.query('DELETE FROM \"Like\" WHERE \"userId\" = ANY(\$1) OR \"postId\" = ANY(\$2)', [ids, posts]);
    await c.query('DELETE FROM \"Comment\" WHERE \"authorId\" = ANY(\$1) OR \"postId\" = ANY(\$2)', [ids, posts]);
    await c.query('DELETE FROM \"Post\" WHERE id = ANY(\$1)', [posts]);
    await c.query('DELETE FROM \"Follow\" WHERE \"followerId\" = ANY(\$1) OR \"followingId\" = ANY(\$1)', [ids]);
    await c.query('DELETE FROM \"Notification\" WHERE \"userId\" = ANY(\$1) OR \"actorId\" = ANY(\$1)', [ids]);
    await c.query('DELETE FROM \"Session\" WHERE \"userId\" = ANY(\$1)', [ids]);
    await c.query('DELETE FROM \"VerificationToken\" WHERE \"userId\" = ANY(\$1)', [ids]);
    await c.query('DELETE FROM \"User\" WHERE id = ANY(\$1)', [ids]);
    console.log('smoke cleanup: removed', ids.length, 'users');
  }
  await c.end();
})().catch(e => { console.error('cleanup failed', e.message); process.exit(1); });
"

[ "$FAIL" = 0 ]

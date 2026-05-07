def trim(n):
  if . == null then ""
  elif (tostring | length) > n then (tostring[:n] + "...")
  else tostring
  end;

if .type == "system" and .subtype == "init" then
  "-- session start (model: \(.model // "?")) --"
elif .type == "assistant" then
  .message.content[] |
    if .type == "text" then
      "\n[claude] \(.text)"
    elif .type == "tool_use" then
      "[tool ] \(.name)  \(.input | trim(120))"
    else empty
    end
elif .type == "user" then
  .message.content[]? |
    if .type == "tool_result" then
      "[ ok  ] \((if (.content | type) == "array" then (.content[0].text // "") else (.content // "") end) | trim(160))"
    else empty
    end
elif .type == "result" then
  "-- done: \(.subtype) ($\(.total_cost_usd // 0), \(.num_turns // 0) turns) --"
else empty
end

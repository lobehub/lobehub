export const CLAIM_OR_ENQUEUE_SCRIPT = `
local active = redis.call('GET', KEYS[1])
local duplicate = redis.call('SISMEMBER', KEYS[3], ARGV[2]) == 1

local function claim(recoveredItems)
  redis.call('SET', KEYS[1], ARGV[3], 'EX', tonumber(ARGV[7]))
  redis.call('SET', KEYS[4], ARGV[4], 'EX', tonumber(ARGV[10]))
  redis.call('SET', KEYS[5], ARGV[5], 'EX', tonumber(ARGV[8]))
  redis.call('SADD', KEYS[3], ARGV[2])
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[9]))
  local result = {
    decision = 'proceed',
    activeOperationId = ARGV[3],
    queueId = ARGV[2]
  }
  if recoveredItems then result['recoveredItems'] = recoveredItems end
  return cjson.encode(result)
end

if not active then
  if redis.call('LLEN', KEYS[2]) > 0 then
    if not duplicate then
      redis.call('RPUSH', KEYS[2], ARGV[1])
    end
    redis.call('DEL', KEYS[6])
    redis.call('RENAME', KEYS[2], KEYS[6])
    redis.call('EXPIRE', KEYS[6], tonumber(ARGV[8]))
    local rows = redis.call('LRANGE', KEYS[6], 0, -1)
    local recoveredItems = {}
    for index, row in ipairs(rows) do recoveredItems[index] = cjson.decode(row) end
    return claim(recoveredItems)
  end

  if duplicate then
    return cjson.encode({ decision = 'duplicate', activeOperationId = '', queueId = ARGV[2] })
  end
  return claim(nil)
end

if duplicate then
  return cjson.encode({ decision = 'duplicate', activeOperationId = active, queueId = ARGV[2] })
end

local maxLength = tonumber(ARGV[6])
if maxLength > 0 and redis.call('LLEN', KEYS[2]) >= maxLength then
  return cjson.encode({ decision = 'rejected', activeOperationId = active, queueId = ARGV[2] })
end

redis.call('RPUSH', KEYS[2], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[7]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[8]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[9]))
redis.call('EXPIRE', KEYS[5], tonumber(ARGV[8]))
return cjson.encode({ decision = 'queued', activeOperationId = active, queueId = ARGV[2] })
`.trim();

export const COMMIT_RECOVERED_CLAIM_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if redis.call('EXISTS', KEYS[4]) == 1 then return 0 end
redis.call('DEL', KEYS[3])
return 1
`.trim();

export const INSPECT_AND_REFRESH_SCRIPT = `
if redis.call('GET', KEYS[4]) ~= ARGV[2] then return '' end
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return '' end

local contextRaw = redis.call('GET', KEYS[5])
if not contextRaw then return '' end

redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[4], tonumber(ARGV[6]))
redis.call('EXPIRE', KEYS[5], tonumber(ARGV[4]))
if redis.call('EXISTS', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4])) end
if redis.call('EXISTS', KEYS[3]) == 1 then redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5])) end

return cjson.encode({
  context = cjson.decode(contextRaw),
  hasPending = redis.call('LLEN', KEYS[2]) > 0
})
`.trim();

export const ADOPT_OWNERSHIP_SCRIPT = `
local active = redis.call('GET', KEYS[1])
local nextOperationId = ARGV[2]
local expectedOldOperationId = ARGV[3]

if active == nextOperationId then
  if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
elseif active then
  if expectedOldOperationId == '' or active ~= expectedOldOperationId then return 0 end
  if redis.call('GET', KEYS[4]) ~= ARGV[1] then return 0 end
  redis.call('DEL', KEYS[4])
else
  -- A waiting-for-human operation may already have compare-released itself.
  -- In that case the resume operation may claim the still-pending context.
  if expectedOldOperationId ~= '' and redis.call('GET', KEYS[4]) == ARGV[1] then
    redis.call('DEL', KEYS[4])
  end
end

redis.call('SET', KEYS[1], nextOperationId, 'EX', tonumber(ARGV[5]))
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[8]))
redis.call('SET', KEYS[3], ARGV[4], 'EX', tonumber(ARGV[6]))
if redis.call('EXISTS', KEYS[5]) == 1 then redis.call('EXPIRE', KEYS[5], tonumber(ARGV[6])) end
if redis.call('EXISTS', KEYS[6]) == 1 then redis.call('EXPIRE', KEYS[6], tonumber(ARGV[7])) end
return 1
`.trim();

export const BEGIN_HANDOFF_SCRIPT = `
local function readItems()
  local rows = redis.call('LRANGE', KEYS[3], 0, -1)
  local items = {}
  for index, row in ipairs(rows) do items[index] = cjson.decode(row) end
  return items
end

local existingRaw = redis.call('GET', KEYS[8])
if existingRaw then
  return cjson.encode({ receipt = cjson.decode(existingRaw), items = readItems() })
end

if redis.call('GET', KEYS[5]) ~= ARGV[3] then
  return cjson.encode({ code = 'not_owner' })
end
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return cjson.encode({ code = 'not_owner' })
end
if redis.call('LLEN', KEYS[2]) == 0 then
  return cjson.encode({ code = 'no_pending' })
end

local contextRaw = redis.call('GET', KEYS[7])
if not contextRaw then return cjson.encode({ code = 'missing_context' }) end

redis.call('DEL', KEYS[3])
redis.call('RENAME', KEYS[2], KEYS[3])
local items = readItems()
local consumedIds = {}
for index, item in ipairs(items) do consumedIds[index] = item['id'] end

local receipt = {
  consumedQueueIds = consumedIds,
  context = cjson.decode(contextRaw),
  nextOperationId = ARGV[2],
  oldOperationId = ARGV[1],
  status = 'pending'
}
local receiptRaw = cjson.encode(receipt)

redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[4]))
redis.call('SET', KEYS[6], ARGV[3], 'EX', tonumber(ARGV[7]))
redis.call('EXPIRE', KEYS[5], tonumber(ARGV[7]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5]))
redis.call('EXPIRE', KEYS[4], tonumber(ARGV[6]))
redis.call('EXPIRE', KEYS[7], tonumber(ARGV[5]))
redis.call('SET', KEYS[9], ARGV[1], 'EX', tonumber(ARGV[8]))
redis.call('SET', KEYS[8], receiptRaw, 'EX', tonumber(ARGV[8]))

return cjson.encode({ receipt = receipt, items = items })
`.trim();

export const COMMIT_HANDOFF_SCRIPT = `
local receiptRaw = redis.call('GET', KEYS[5])
if not receiptRaw then return 0 end
local receipt = cjson.decode(receiptRaw)
if receipt['nextOperationId'] ~= ARGV[2] then return 0 end
if receipt['status'] == 'committed' then return 1 end
if receipt['status'] ~= 'pending' then return 0 end

receipt['status'] = 'committed'
receipt['nextOperation'] = cjson.decode(ARGV[3])
redis.call('SET', KEYS[5], cjson.encode(receipt), 'EX', tonumber(ARGV[8]))
redis.call('DEL', KEYS[2], KEYS[3], KEYS[9])

if redis.call('GET', KEYS[1]) == ARGV[2] then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
end
if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('EXPIRE', KEYS[4], tonumber(ARGV[7])) end
if redis.call('EXISTS', KEYS[6]) == 1 then redis.call('EXPIRE', KEYS[6], tonumber(ARGV[5])) end
if redis.call('EXISTS', KEYS[7]) == 1 then redis.call('EXPIRE', KEYS[7], tonumber(ARGV[6])) end
if redis.call('EXISTS', KEYS[8]) == 1 then redis.call('EXPIRE', KEYS[8], tonumber(ARGV[5])) end
return 1
`.trim();

export const FAIL_HANDOFF_SCRIPT = `
local receiptRaw = redis.call('GET', KEYS[5])
if not receiptRaw then return 0 end
local receipt = cjson.decode(receiptRaw)
if receipt['nextOperationId'] ~= ARGV[2] then return 0 end
if receipt['status'] == 'failed' then return 1 end
if receipt['status'] ~= 'pending' then return 0 end

receipt['status'] = 'failed'
receipt['nextOperation'] = cjson.decode(ARGV[3])
redis.call('SET', KEYS[5], cjson.encode(receipt), 'EX', tonumber(ARGV[7]))
redis.call('DEL', KEYS[2], KEYS[3], KEYS[9])
if redis.call('GET', KEYS[1]) == ARGV[2] then redis.call('DEL', KEYS[1]) end
redis.call('DEL', KEYS[4])
if redis.call('EXISTS', KEYS[6]) == 1 then redis.call('EXPIRE', KEYS[6], tonumber(ARGV[4])) end
if redis.call('EXISTS', KEYS[7]) == 1 then redis.call('EXPIRE', KEYS[7], tonumber(ARGV[5])) end
if redis.call('EXISTS', KEYS[8]) == 1 then redis.call('EXPIRE', KEYS[8], tonumber(ARGV[6])) end
return 1
`.trim();

export const ROLLBACK_HANDOFF_SCRIPT = `
local receiptRaw = redis.call('GET', KEYS[5])
if not receiptRaw then return 0 end
local receipt = cjson.decode(receiptRaw)
if receipt['nextOperationId'] ~= ARGV[2] then return 0 end
if receipt['status'] == 'rolled_back' then return 1 end
if receipt['status'] ~= 'pending' then return 0 end

local snapshot = redis.call('LRANGE', KEYS[2], 0, -1)
local pending = redis.call('LRANGE', KEYS[6], 0, -1)
redis.call('DEL', KEYS[6])
for _, row in ipairs(snapshot) do redis.call('RPUSH', KEYS[6], row) end
for _, row in ipairs(pending) do redis.call('RPUSH', KEYS[6], row) end
if #snapshot + #pending > 0 then redis.call('EXPIRE', KEYS[6], tonumber(ARGV[3])) end

receipt['status'] = 'rolled_back'
redis.call('SET', KEYS[5], cjson.encode(receipt), 'EX', tonumber(ARGV[6]))
redis.call('DEL', KEYS[2], KEYS[3], KEYS[9])
if redis.call('GET', KEYS[1]) == ARGV[2] then redis.call('DEL', KEYS[1]) end
redis.call('DEL', KEYS[4])
if redis.call('EXISTS', KEYS[7]) == 1 then redis.call('EXPIRE', KEYS[7], tonumber(ARGV[4])) end
if redis.call('EXISTS', KEYS[8]) == 1 then redis.call('EXPIRE', KEYS[8], tonumber(ARGV[3])) end
return 1
`.trim();

export const RELEASE_OWNED_SCRIPT = `
if redis.call('GET', KEYS[4]) ~= ARGV[2] then return 0 end
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end

redis.call('DEL', KEYS[1], KEYS[4])
local restoredInflight = false
if ARGV[3] == '1' then
  if redis.call('EXISTS', KEYS[6]) == 1 and redis.call('EXISTS', KEYS[7]) == 0 then
    if ARGV[7] == '1' then
      redis.call('DEL', KEYS[6])
    else
      local recovered = redis.call('LRANGE', KEYS[6], 0, -1)
      local pending = redis.call('LRANGE', KEYS[2], 0, -1)
      redis.call('DEL', KEYS[2])
      for _, row in ipairs(recovered) do redis.call('RPUSH', KEYS[2], row) end
      for _, row in ipairs(pending) do redis.call('RPUSH', KEYS[2], row) end
      redis.call('DEL', KEYS[6])
      restoredInflight = true
    end
  end
  if ARGV[6] ~= '' and not restoredInflight and ARGV[7] ~= '1' then
    redis.call('SREM', KEYS[3], ARGV[6])
  end
  if redis.call('EXISTS', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4])) end
  if redis.call('EXISTS', KEYS[3]) == 1 then redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5])) end
  if redis.call('EXISTS', KEYS[5]) == 1 then redis.call('EXPIRE', KEYS[5], tonumber(ARGV[4])) end
else
  if ARGV[6] ~= '' and ARGV[7] ~= '1' then redis.call('SREM', KEYS[3], ARGV[6]) end
  redis.call('DEL', KEYS[2], KEYS[3], KEYS[5], KEYS[6], KEYS[7])
end
return 1
`.trim();

export const REMOVE_QUEUED_SCRIPT = `
local rows = redis.call('LRANGE', KEYS[1], 0, -1)
for _, row in ipairs(rows) do
  local ok, item = pcall(cjson.decode, row)
  if ok and item['id'] == ARGV[1] then
    redis.call('LREM', KEYS[1], 1, row)
    redis.call('SREM', KEYS[2], ARGV[1])
    if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
    if redis.call('EXISTS', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3])) end
    return row
  end
end
return ''
`.trim();

export const UPDATE_QUEUED_SCRIPT = `
local rows = redis.call('LRANGE', KEYS[1], 0, -1)
local patch = cjson.decode(ARGV[2])
for index, row in ipairs(rows) do
  local ok, item = pcall(cjson.decode, row)
  if ok and item['id'] == ARGV[1] then
    for key, value in pairs(patch) do item[key] = value end
    local updated = cjson.encode(item)
    redis.call('LSET', KEYS[1], index - 1, updated)
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
    return updated
  end
end
return ''
`.trim();

export const CANCEL_AND_CLEAR_SCRIPT = `
local currentActive = redis.call('GET', KEYS[1]) or ''
local currentHandoff = redis.call('GET', KEYS[6]) or ''
if currentActive ~= ARGV[1] or currentHandoff ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
if KEYS[7] ~= '' then redis.call('DEL', KEYS[7]) end
if KEYS[8] ~= '' then redis.call('DEL', KEYS[8]) end
return 1
`.trim();

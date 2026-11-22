--!nocheck
-- Cascade Studio relay plugin.
-- Install this file as a local plugin (Plugins Folder), enable HTTP requests
-- for the place, then open the Cascade widget and paste the URL + pairing code.
-- The plugin never asks for a Roblox cookie, password, or API key. The relay
-- token is only stored inside this Studio session.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local toolbar = plugin:CreateToolbar("Cascade")
local openButton = toolbar:CreateButton("Cascade Studio", "Connect this place to Cascade", "rbxasset://textures/StudioToolBar/SelectIcon.png")
local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 330, 520, 300, 400)
local widget = plugin:CreateDockWidgetPluginGui("CascadeStudioWidget", info)
widget.Title = "Cascade Studio"
widget.Name = "Cascade Studio"

local BASE, TOKEN, CONNECTED = "", "", false
local POLL_SECONDS = 1.4
local VERSION = "1.0.0"
local stop = false
local busy = false

local root = Instance.new("Frame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(24, 24, 30)
root.BorderSizePixel = 0
root.Parent = widget

local pad = Instance.new("UIPadding")
pad.PaddingTop = UDim.new(0, 14)
pad.PaddingBottom = UDim.new(0, 14)
pad.PaddingLeft = UDim.new(0, 14)
pad.PaddingRight = UDim.new(0, 14)
pad.Parent = root

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = root

local function label(text, size, color)
    local l = Instance.new("TextLabel")
    l.Size = UDim2.new(1, 0, 0, size or 18)
    l.BackgroundTransparency = 1
    l.Font = Enum.Font.Gotham
    l.TextSize = 12
    l.TextColor3 = color or Color3.fromRGB(190, 190, 200)
    l.TextXAlignment = Enum.TextXAlignment.Left
    l.TextWrapped = true
    l.Text = text
    l.Parent = root
    return l
end

local function textBox(placeholder, secret)
    local t = Instance.new("TextBox")
    t.Size = UDim2.new(1, 0, 0, 34)
    t.BackgroundColor3 = Color3.fromRGB(15, 15, 19)
    t.TextColor3 = Color3.fromRGB(240, 240, 245)
    t.PlaceholderText = placeholder
    t.PlaceholderColor3 = Color3.fromRGB(120, 120, 132)
    t.Font = Enum.Font.Code
    t.TextSize = 12
    t.ClearTextOnFocus = false
    t.Text = ""
    t.Parent = root
    if secret then
        -- Roblox TextBox has no password mode; the pairing code is short-lived,
        -- single-use and exchanged for a session token immediately.
    end
    return t
end

local title = label("CASCADE STUDIO", 22, Color3.fromRGB(255, 255, 255))
title.Font = Enum.Font.GothamBold
title.TextSize = 15
label("Connect this open place to Cascade. HTTP requests must be enabled for the experience.", 34)
local urlBox = textBox("Connection URL, e.g. https://cascade.example.com")
local codeBox = textBox("Pairing code from Cascade")
local connectButton = Instance.new("TextButton")
connectButton.Size = UDim2.new(1, 0, 0, 36)
connectButton.BackgroundColor3 = Color3.fromRGB(225, 29, 72)
connectButton.TextColor3 = Color3.fromRGB(255, 255, 255)
connectButton.Font = Enum.Font.GothamBold
connectButton.TextSize = 12
connectButton.Text = "Connect to Cascade"
connectButton.Parent = root
local status = label("Not connected", 42, Color3.fromRGB(255, 180, 100))
local infoLine = label("", 34)

local function normalizeBase(value)
    local v = tostring(value or ""):gsub("%s+", "")
    v = v:gsub("/+$", "")
    -- Accept either the origin shown by Cascade or the full relay endpoint.
    v = v:gsub("/api/studio/relay$", "")
    v = v:gsub("/api/studio$", "")
    v = v:gsub("/relay$", "")
    return v
end

local function request(method, path, body)
    if BASE == "" then return nil, "Connection URL is empty" end
    local options = {
        Url = BASE .. path,
        Method = method,
        Headers = { ["Content-Type"] = "application/json" },
        Body = body and HttpService:JSONEncode(body) or nil,
    }
    if TOKEN ~= "" then options.Headers["x-studio-token"] = TOKEN end
    local ok, result = pcall(function()
        return HttpService:RequestAsync(options)
    end)
    if not ok then return nil, tostring(result) end
    if type(result) ~= "table" then return nil, tostring(result) end
    local decoded = nil
    if result.Body and result.Body ~= "" then
        local okJson, value = pcall(function() return HttpService:JSONDecode(result.Body) end)
        if okJson then decoded = value end
    end
    if not result.Success then
        local message = decoded and (decoded.error or decoded.message) or ("HTTP " .. tostring(result.StatusCode))
        return nil, tostring(message), result.StatusCode
    end
    return decoded or {}
end

local function setStatus(text, color)
    status.Text = text
    status.TextColor3 = color or Color3.fromRGB(255, 180, 100)
end

local SERVICES = {
    "Workspace", "ReplicatedStorage", "ReplicatedFirst", "ServerStorage",
    "ServerScriptService", "StarterGui", "StarterPack", "StarterPlayer",
    "Lighting", "SoundService", "Teams", "Players", "Chat", "TestService",
}
local SERVICE_SET = {}
for _, name in ipairs(SERVICES) do SERVICE_SET[name] = true end

local idFor
local function ensureId(inst)
    local existing = inst:GetAttribute("CascadeId")
    if type(existing) == "string" and existing ~= "" then return existing end
    local id = HttpService:GenerateGUID(false)
    pcall(function() inst:SetAttribute("CascadeId", id) end)
    return id
end

local function vector3Json(v)
    if typeof(v) ~= "Vector3" then return nil end
    return { x = v.X, y = v.Y, z = v.Z }
end

local function vector2Json(v)
    if typeof(v) ~= "Vector2" then return nil end
    return { x = v.X, y = v.Y }
end

local function udim2Json(v)
    if typeof(v) ~= "UDim2" then return nil end
    return { xs = v.X.Scale, xo = v.X.Offset, ys = v.Y.Scale, yo = v.Y.Offset }
end

local function cframeJson(v)
    if typeof(v) ~= "CFrame" then return nil end
    local p = v.Position
    local rx, ry, rz = v:ToOrientation()
    return { x = p.X, y = p.Y, z = p.Z, rx = math.deg(rx), ry = math.deg(ry), rz = math.deg(rz) }
end

local function colorJson(v)
    if typeof(v) ~= "Color3" then return nil end
    return string.format("#%02x%02x%02x", math.floor(v.R * 255 + .5), math.floor(v.G * 255 + .5), math.floor(v.B * 255 + .5))
end

local function readProps(inst)
    local p = {}
    local function get(name)
        local ok, value = pcall(function() return inst[name] end)
        if ok then return value end
        return nil
    end
    p.Name = inst.Name
    p.ClassName = inst.ClassName
    p.Archivable = get("Archivable")
    p.Enabled = get("Enabled")
    local pos = get("Position")
    if typeof(pos) == "Vector3" then p.Position = vector3Json(pos) end
    local size = get("Size")
    if typeof(size) == "Vector3" then p.Size = vector3Json(size) end
    local cframe = get("CFrame")
    if typeof(cframe) == "CFrame" then p.CFrame = cframeJson(cframe) end
    local color = get("Color")
    if typeof(color) == "Color3" then p.Color = colorJson(color) end
    local transparency = get("Transparency")
    if type(transparency) == "number" then p.Transparency = transparency end
    local anchored = get("Anchored")
    if type(anchored) == "boolean" then p.Anchored = anchored end
    local collide = get("CanCollide")
    if type(collide) == "boolean" then p.CanCollide = collide end
    local material = get("Material")
    if typeof(material) == "EnumItem" then p.Material = material.Name end
    local shape = get("Shape")
    if typeof(shape) == "EnumItem" then p.Shape = shape.Name end
    local text = get("Text")
    if type(text) == "string" then p.Text = text end
    local textSize = get("TextSize")
    if type(textSize) == "number" then p.TextSize = textSize end
    local background = get("BackgroundColor3")
    if typeof(background) == "Color3" then p.BackgroundColor3 = colorJson(background) end
    local textColor = get("TextColor3")
    if typeof(textColor) == "Color3" then p.TextColor3 = colorJson(textColor) end
    local image = get("Image")
    if type(image) == "string" then p.Image = image end
    local visible = get("Visible")
    if type(visible) == "boolean" then p.Visible = visible end
    local source = get("Source")
    if type(source) == "string" then p.Source = source end
    local disabled = get("Disabled")
    if type(disabled) == "boolean" then p.Disabled = disabled end
    p.Attributes = {}
    local okAttr, attrs = pcall(function() return inst:GetAttributes() end)
    if okAttr then
        for k, v in pairs(attrs) do
            local t = typeof(v)
            if t == "string" or t == "number" or t == "boolean" then p.Attributes[k] = v end
        end
    end
    local okTags, tags = pcall(function() return inst:GetTags() end)
    if okTags then p.Tags = tags end
    local okChildren, children = pcall(function() return inst:GetChildren() end)
    return p, okChildren and children or {}
end

local MAX_NODES = 4000
local nodeCount = 0

local function serialize(inst, depth)
    if nodeCount >= MAX_NODES then return nil end
    local id = ensureId(inst)
    nodeCount = nodeCount + 1
    local props, children = readProps(inst)
    local node = { id = id, className = inst.ClassName, name = inst.Name, props = props, children = {} }
    if depth < 14 then
        table.sort(children, function(a, b) return a.Name < b.Name end)
        for _, child in ipairs(children) do
            local c = serialize(child, depth + 1)
            if c then table.insert(node.children, c) end
        end
    end
    return node
end

local function buildScene()
    nodeCount = 0
    local services = {}
    for _, name in ipairs(SERVICES) do
        local ok, service = pcall(function() return game:GetService(name) end)
        if ok and service then
            local node = serialize(service, 0)
            if node then table.insert(services, node) end
        end
    end
    return {
        placeName = game.Name,
        placeId = game.PlaceId,
        services = services,
        pluginVersion = VERSION,
        capturedAt = DateTime.now():ToIsoDate(),
    }
end

local function pushSnapshot()
    if not CONNECTED then return end
    local scene = buildScene()
    local ok, result, code = request("POST", "/api/studio/relay/snapshot", { scene = scene })
    if not ok then
        setStatus("Snapshot failed: " .. tostring(result), Color3.fromRGB(255, 100, 100))
        if code == 401 or code == 410 then CONNECTED = false end
        return
    end
    setStatus(string.format("Connected · %d services · synced", #scene.services), Color3.fromRGB(90, 220, 160))
end

local function findById(serviceRoots, id)
    for _, service in ipairs(serviceRoots) do
        local ok, value = pcall(function() return service:GetAttribute("CascadeId") end)
        if ok and value == id then return service end
        local okDesc, desc = pcall(function() return service:GetDescendants() end)
        if okDesc then
            for _, inst in ipairs(desc) do
                local okId, valueId = pcall(function() return inst:GetAttribute("CascadeId") end)
                if okId and valueId == id then return inst end
            end
        end
    end
    return nil
end

local function applyProp(inst, key, value)
    if key == "Name" or key == "ClassName" then return end
    if key == "Position" and type(value) == "table" then
        inst.Position = Vector3.new(tonumber(value.x) or 0, tonumber(value.y) or 0, tonumber(value.z) or 0)
    elseif key == "Size" and type(value) == "table" then
        inst.Size = Vector3.new(math.max(.05, tonumber(value.x) or 1), math.max(.05, tonumber(value.y) or 1), math.max(.05, tonumber(value.z) or 1))
    elseif key == "CFrame" and type(value) == "table" then
        local pos = Vector3.new(tonumber(value.x) or 0, tonumber(value.y) or 0, tonumber(value.z) or 0)
        inst.CFrame = CFrame.new(pos) * CFrame.Angles(math.rad(tonumber(value.rx) or 0), math.rad(tonumber(value.ry) or 0), math.rad(tonumber(value.rz) or 0))
    elseif key == "Color" and type(value) == "string" then
        local hex = value:gsub("#", "")
        inst.Color = Color3.fromRGB(tonumber(hex:sub(1, 2), 16) or 255, tonumber(hex:sub(3, 4), 16) or 255, tonumber(hex:sub(5, 6), 16) or 255)
    elseif key == "Transparency" then inst.Transparency = math.clamp(tonumber(value) or 0, 0, 1)
    elseif key == "Anchored" then inst.Anchored = value == true
    elseif key == "CanCollide" then inst.CanCollide = value == true
    elseif key == "Material" then
        local ok, e = pcall(function() return Enum.Material[value] end)
        if ok and e then inst.Material = e end
    elseif key == "Shape" then
        local ok, e = pcall(function() return Enum.PartType[value] end)
        if ok and e then inst.Shape = e end
    elseif key == "Text" then inst.Text = tostring(value):sub(1, 20000)
    elseif key == "TextSize" then inst.TextSize = math.clamp(tonumber(value) or 14, 1, 200)
    elseif key == "BackgroundColor3" and type(value) == "string" then
        local hex = value:gsub("#", "")
        inst.BackgroundColor3 = Color3.fromRGB(tonumber(hex:sub(1, 2), 16) or 255, tonumber(hex:sub(3, 4), 16) or 255, tonumber(hex:sub(5, 6), 16) or 255)
    elseif key == "TextColor3" and type(value) == "string" then
        local hex = value:gsub("#", "")
        inst.TextColor3 = Color3.fromRGB(tonumber(hex:sub(1, 2), 16) or 255, tonumber(hex:sub(3, 4), 16) or 255, tonumber(hex:sub(5, 6), 16) or 255)
    elseif key == "Image" then inst.Image = tostring(value):sub(1, 1000)
    elseif key == "Visible" then inst.Visible = value == true
    elseif key == "Enabled" then inst.Enabled = value == true
    elseif key == "Disabled" then inst.Disabled = value == true
    elseif key == "Archivable" then inst.Archivable = value == true
    elseif key == "Source" and inst:IsA("LuaSourceContainer") then
        inst.Source = tostring(value):sub(1, 200000)
    end
end

local function applyCommand(command)
    local payload = command.payload or {}
    local services = {}
    for _, name in ipairs(SERVICES) do
        local ok, svc = pcall(function() return game:GetService(name) end)
        if ok and svc then table.insert(services, svc) end
    end
    local kind = command.kind
    if kind == "create" then
        local parent = payload.parentId and findById(services, payload.parentId) or workspace
        if not parent then return false, "parent not found" end
        local ok, err = pcall(function()
            local inst = Instance.new(tostring(payload.className or "Part"))
            inst.Name = tostring(payload.name or inst.Name):sub(1, 100)
            for key, value in pairs(payload.props or {}) do applyProp(inst, key, value) end
            inst:SetAttribute("CascadeId", payload.clientId or HttpService:GenerateGUID(false))
            inst.Parent = parent
        end)
        if not ok then return false, tostring(err) end
    elseif kind == "update" then
        local inst = findById(services, payload.instanceId)
        if not inst then return false, "instance not found" end
        local ok, err = pcall(function()
            for key, value in pairs(payload.props or {}) do applyProp(inst, key, value) end
        end)
        if not ok then return false, tostring(err) end
    elseif kind == "rename" then
        local inst = findById(services, payload.instanceId)
        if not inst then return false, "instance not found" end
        inst.Name = tostring(payload.name or "Instance"):sub(1, 100)
    elseif kind == "reparent" then
        local inst = findById(services, payload.instanceId)
        local parent = findById(services, payload.parentId)
        if not inst or not parent then return false, "instance or parent not found" end
        inst.Parent = parent
    elseif kind == "delete" then
        local inst = findById(services, payload.instanceId)
        if not inst then return false, "instance not found" end
        if inst:IsA("DataModel") or inst.Parent == game then return false, "service deletion is not allowed" end
        inst:Destroy()
    elseif kind == "script" then
        local inst = findById(services, payload.instanceId)
        if not inst or not inst:IsA("LuaSourceContainer") then return false, "script not found" end
        inst.Source = tostring(payload.source or ""):sub(1, 200000)
    elseif kind == "snapshot" then
        -- The plugin performs a full snapshot after the batch.
    else
        return false, "unsupported command: " .. tostring(kind)
    end
    return true
end

local function poll()
    if not CONNECTED or busy then return end
    busy = true
    local ok, data, code = request("GET", "/api/studio/relay/poll")
    if not ok then
        busy = false
        if code == 401 or code == 410 then
            CONNECTED = false
            setStatus("Connection revoked. Pair again from Cascade.", Color3.fromRGB(255, 100, 100))
        end
        return
    end
    if data.revoked then
        CONNECTED = false
        busy = false
        setStatus("Connection revoked by Cascade.", Color3.fromRGB(255, 100, 100))
        return
    end
    local commands = data.commands or {}
    if #commands > 0 then
        local records = {}
        local recording = ChangeHistoryService:TryBeginRecording("Cascade")
        for _, command in ipairs(commands) do
            local okApply, err = applyCommand(command)
            table.insert(records, { id = command.id, ok = okApply, error = okApply and nil or tostring(err) })
        end
        if recording then ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
        request("POST", "/api/studio/relay/ack", { commands = records })
        pushSnapshot()
        setStatus(string.format("Connected · applied %d change%s", #records, #records == 1 and "" or "s"), Color3.fromRGB(90, 220, 160))
    end
    busy = false
end

local function connect()
    BASE = normalizeBase(urlBox.Text)
    local code = tostring(codeBox.Text):gsub("%s+", "")
    if BASE == "" or code == "" then
        setStatus("Enter the connection URL and pairing code.", Color3.fromRGB(255, 120, 120))
        return
    end
    setStatus("Connecting…")
    local ok, data = request("POST", "/api/studio/relay/connect", { code = code, placeName = game.Name, pluginVersion = VERSION })
    if not ok then
        setStatus("Connection failed: " .. tostring(data or "unknown"), Color3.fromRGB(255, 120, 120))
        return
    end
    TOKEN = data.token
    CONNECTED = true
    codeBox.Text = ""
    infoLine.Text = "Project: " .. tostring(data.projectName or "Cascade project") .. " · relay connected"
    setStatus("Connected · waiting for commands", Color3.fromRGB(90, 220, 160))
    pushSnapshot()
end

connectButton.MouseButton1Click:Connect(connect)
openButton.Click:Connect(function()
    widget.Enabled = not widget.Enabled
end)

local heartbeat = task.spawn(function()
    while not stop do
        task.wait(10)
        if CONNECTED then
            local ok, data, code = request("POST", "/api/studio/relay/heartbeat", {})
            if not ok and (code == 401 or code == 410) then
                CONNECTED = false
                setStatus("Connection ended. Pair again from Cascade.", Color3.fromRGB(255, 120, 120))
            elseif ok then
                infoLine.Text = string.format("Heartbeat ok · %s · v%s", tostring(data.placeName or game.Name), VERSION)
            end
        end
    end
end)

local poller = task.spawn(function()
    while not stop do
        if CONNECTED then
            local ok, err = pcall(poll)
            if not ok then setStatus("Poll error: " .. tostring(err), Color3.fromRGB(255, 120, 120)) end
        end
        task.wait(POLL_SECONDS)
    end
end)

plugin.Unloading:Connect(function()
    stop = true
    CONNECTED = false
    pcall(function() task.cancel(heartbeat) end)
    pcall(function() task.cancel(poller) end)
end)

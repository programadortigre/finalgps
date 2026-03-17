-- Car profile for OSRM
local profile = {
  properties = {
    weight_name = 'routability',
    weight_units = 'seconds',
    weight_obey_oneway = true,
    use_turn_restrictions = true,
    traffic_signal_penalty = 2,
    turn_bias = 1.4,
    turn_penalty = 0,
    u_turn_penalty = math.huge,
  },

  default_mode = mode.driving,
  default_speed = 15,
  oneway_handling = 'specific',
  
  speed = {
    motorway = 90,
    motorway_link = 75,
    trunk = 85,
    trunk_link = 70,
    primary = 65,
    primary_link = 60,
    secondary = 55,
    secondary_link = 50,
    tertiary = 40,
    tertiary_link = 40,
    unclassified = 25,
    residential = 25,
    service = 15,
    living_street = 10,
    pedestrian = 5,
    footway = 5,
    cycleway = 16,
    track = 5,
    path = 5,
    default = 10
  }
}

function process_node(profile, node, result)
  -- Nothing special
end

function process_way(profile, way, result)
  local highway = way:get_value_by_key('highway')
  local access = way:get_value_by_key('access')
  local oneway = way:get_value_by_key('oneway')
  
  -- Initialize speeds with defaults
  local speed = profile.speed[highway] or profile.speed.default
  
  -- Check access restrictions - mark as not routable
  if access and (access == 'no' or access == 'private' or access == 'restricted') then
    result.forward_speed = 0
    result.backward_speed = 0
    return
  end
  
  -- Block certain highway types for cars
  if highway == 'footway' or highway == 'pedestrian' or highway == 'path' or highway == 'cycleway' then
    result.forward_speed = 0
    result.backward_speed = 0
    return
  end
  
  -- Don't route on certain types
  if highway == 'construction' or highway == 'proposed' or highway == 'abandoned' then
    result.forward_speed = 0
    result.backward_speed = 0
    return
  end
  
  -- Handle one-way streets
  if oneway == 'yes' or oneway == '1' then
    result.forward_speed = speed
    result.backward_speed = 0
  elseif oneway == '-1' or oneway == 'reverse' then
    result.forward_speed = 0
    result.backward_speed = speed
  else
    result.forward_speed = speed
    result.backward_speed = speed
  end
end

function process_turn(profile, turn)
  turn.duration = 0
  turn.weight = 0
  
  if turn.direction_modifier == direction.u_turn then
    turn.weight = math.huge
  end
end

return profile

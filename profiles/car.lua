-- Minimal Car Routing Profile for OSRM
local profile = {
  properties = {
    weight_name = 'routability',
    weight_units = 'seconds',
    weight_obey_oneway = true,
    use_turn_restrictions = true,
  },

  default_mode = mode.driving,
  default_speed = 15,
}

function process_node(profile, node, result)
end

function process_way(profile, way, result)
  local highway = way:get_value_by_key('highway')
  local access = way:get_value_by_key('access')
  
  -- Reject only obvious non-automotive ways
  if access == 'no' or access == 'private' then
    result.forward_speed = 0
    result.backward_speed = 0
    return
  end
  
  -- Reject footways, paths, etc
  if highway == 'footway' or highway == 'path' or highway == 'cycleway' or 
     highway == 'pedestrian' or highway == 'steps' then
    result.forward_speed = 0
    result.backward_speed = 0
    return
  end
  
  -- Default: use reasonable speed
  local speeds = {
    motorway = 90,
    trunk = 85,
    primary = 65,
    secondary = 55,
    tertiary = 40,
    unclassified = 25,
    residential = 25,
    service = 15,
    living_street = 10
  }
  
  local speed = speeds[highway] or 15
  
  -- Check oneway
  if way:get_value_by_key('oneway') == 'yes' or way:get_value_by_key('oneway') == '1' then
    result.forward_speed = speed
    result.backward_speed = 0
  elseif way:get_value_by_key('oneway') == '-1' then
    result.forward_speed = 0
    result.backward_speed = speed
  else
    result.forward_speed = speed
    result.backward_speed = speed
  end
end

function process_turn(profile, turn)
end

return profile

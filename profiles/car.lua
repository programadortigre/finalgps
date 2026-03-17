-- Car routing profile for OSRM
local profile = {
  properties = {
    weight_name = 'routability',
    weight_units = 'seconds',
  },

  default_mode = mode.driving,
  default_speed = 20,
}

function process_node(profile, node, result)
  -- No special node processing needed
end

function process_way(profile, way, result)
  local highway = way:get_value_by_key('highway')
  local access = way:get_value_by_key('access')
  local oneway = way:get_value_by_key('oneway')
  
  -- Default: allow everything
  local speed = 20
  
  -- Override speed based on highway type
  if highway == 'motorway' then
    speed = 90
  elseif highway == 'motorway_link' then
    speed = 75
  elseif highway == 'trunk' then
    speed = 85
  elseif highway == 'trunk_link' then
    speed = 70
  elseif highway == 'primary' then
    speed = 65
  elseif highway == 'primary_link' then
    speed = 60
  elseif highway == 'secondary' then
    speed = 55
  elseif highway == 'secondary_link' then
    speed = 50
  elseif highway == 'tertiary' then
    speed = 40
  elseif highway == 'tertiary_link' then
    speed = 40
  elseif highway == 'unclassified' then
    speed = 25
  elseif highway == 'residential' then
    speed = 25
  elseif highway == 'service' then
    speed = 15
  elseif highway == 'living_street' then
    speed = 10
  end
  
  -- Block only specific way types
  if access == 'no' or access == 'private' then
    result.forward_speed = 0
    result.backward_speed = 0
    return
  end
  
  if highway == 'footway' or highway == 'pedestrian' or 
     highway == 'path' or highway == 'cycleway' or
     highway == 'steps' or highway == 'track' then
    result.forward_speed = 0
    result.backward_speed = 0
    return
  end
  
  -- Handle oneway
  if oneway == 'yes' or oneway == '1' then
    result.forward_speed = speed
    result.backward_speed = 0
  elseif oneway == '-1' then
    result.forward_speed = 0
    result.backward_speed = speed
  else
    -- Allow both directions
    result.forward_speed = speed
    result.backward_speed = speed
  end
end

function process_turn(profile, turn)
  -- No special turn processing
end

return profile

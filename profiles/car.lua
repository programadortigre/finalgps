-- Avoid name clashes
local utils = require("car/utils")
local way_handlers = require("car/way_handlers")
local relation_handlers = require("car/relation_handlers")
local access = require("car/access")
local restrictions = require("car/restrictions")

local Sequence = require("sequence")

-- Initialize profile
local profile = {
  properties = {
    weight_name                       = 'routability',
    weight_units                      = 'secondsPerMeter',
    weight_obey_oneway                = true,
    weight_traffic_signal_penalty     = 2,
    turn_penalty                      = 0,
    turn_bias                         = preferences.turn_bias,
    u_turn_penalty                    = math.huge,
    continue_straight_at_waypoint     = false,
    use_turn_restrictions             = true,
    traffic_signal_penalty            = 2,
    post_processing_file              = '',
    max_speed_for_map_matching        = 180/3.6, -- 180 kmph -> m/s
    call_tagless_node_function        = false,
    call_tagless_way_function         = false,
    ignore_areas                      = true,
    ignore_northbound_direction       = false,
  },

  default_mode                  = mode.driving,
  default_speed                 = 10,
  oneway_handling               = 'specific', -- Use way:oneway=-1 etc.
  side_road_multiplier          = 0.8, -- Penalty multiplier for service road use
  car_park_penalty              = 180,

  -- Note: this replaces 'biased_speeds'
  speed = {
    motorway        = 90,
    trunk           = 85,
    primary         = 65,
    secondary       = 55,
    tertiary        = 40,
    unclassified    = 25,
    residential     = 25,
    service         = 15,
    walkway         = 6,
    cycleway        = 16,
    track           = 5,
    default         = 10
  },

  -- speeds net of penalties applied to generic speeds above
  penalties = {
    toll             = 0,
    motorway         = 0,
    trunk            = 0,
    primary          = 0,
    secondary        = 0,
    tertiary         = 0,
    secondary_link   = 0,
    primary_link     = 0,
    trunk_link       = 0,
    motorway_link    = 0,
    living_street    = 0,
    road             = 0,
    unclassified     = 0,
    residential      = 0,
    service_link     = -30,
    footway          = math.huge,
    conveyorway      = 0
  },
}

function process_node(profile, node, result, debug)
  -- Nothing to do
end

function process_way(profile, way, result, debug)
  -- Data returned by the function and the speed separation by callbacks follows the following convention:
  -- forward speed -> FSM: FSM_CAR
  -- backward speed -> BSM: BSM_CAR
  -- if result.forward_speed == -1 then the way is not routable in that direction

  local data = {
    highway = way:get_value_by_key('highway'),
    bridge = way:get_value_by_key('bridge'),
    tunnel = way:get_value_by_key('tunnel'),
    railway = way:get_value_by_key('railway'),
    construction = way:get_value_by_key('construction'),
    access = way:get_value_by_key('access'),
    service = way:get_value_by_key('service'),
    motor_car = way:get_value_by_key('motor_car'),
    motorcycle = way:get_value_by_key('motorcycle'),
    bicycle = way:get_value_by_key('bicycle'),
    foot = way:get_value_by_key('foot'),
    goods = way:get_value_by_key('goods'),
    hgv = way:get_value_by_key('hgv'),
    vehicle = way:get_value_by_key('vehicle'),
    psv = way:get_value_by_key('psv'),
    bus = way:get_value_by_key('bus'),
    taxi = way:get_value_by_key('taxi'),
    hazmat = way:get_value_by_key('hazmat'),
    maxspeed = way:get_value_by_key('maxspeed'),
    maxspeed_forward = way:get_value_by_key('maxspeed:forward'),
    maxspeed_backward = way:get_value_by_key('maxspeed:backward'),
    minspeed = way:get_value_by_key('minspeed'),
    accept_charges = way:get_value_by_key('accept_charges'),
    toll = way:get_value_by_key('toll'),
    lanes = way:get_value_by_key('lanes'),
    duration = way:get_value_by_key('duration'),
    weight = way:get_value_by_key('weight'),
    width = way:get_value_by_key('width'),
    height = way:get_value_by_key('height'),
    length = way:get_value_by_key('length'),
    load = way:get_value_by_key('load'),
    surface = way:get_value_by_key('surface'),
    smoothness = way:get_value_by_key('smoothness'),
    sac_scale = way:get_value_by_key('sac_scale'),
    name = way:get_value_by_key('name'),
    ref = way:get_value_by_key('ref'),
    junction = way:get_value_by_key('junction'),
    oneway = way:get_value_by_key('oneway'),
    reversible = way:get_value_by_key('reversible'),
    impassable = way:get_value_by_key('impassable'),
    status = way:get_value_by_key('status'),
    symbols = way:get_value_by_key('symbols'),
    wheelchair = way:get_value_by_key('wheelchair')
  }

  local handlers = Sequence {
    -- first, global rules
    way_handlers.blocked_ways,
    way_handlers.access_Check,
    way_handlers.oneway_handling,
    way_handlers.speed_handling,
    way_handlers.penalties,
    way_handlers.symbolic_speeds
  }

  return handlers(profile, way, result, data, debug)
end

function process_turn(profile, turn)
  turn.duration = 0
  turn.weight = 0

  local turn_type = turn.turn_type
  local angle = turn.angle

  if angle >= 0 and angle < 45 then
    turn.turn_type = direction.uturn
  elseif angle >= 45 and angle < 135 then
    turn.turn_type = direction.sharp_right
  elseif angle >= 135 and angle < 165 then
    turn.turn_type = direction.right
  elseif angle >= 165 and angle < 195 then
    turn.turn_type = direction.straight
  elseif angle >= 195 and angle < 225 then
    turn.turn_type = direction.left
  elseif angle >= 225 and angle < 315 then
    turn.turn_type = direction.sharp_left
  else
    turn.turn_type = direction.uturn
  end
end

return profile

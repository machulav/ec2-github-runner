# CreateFleet()
Request Parameters for `CreateFleetCommand()`


## LaunchTemplateConfigs.N
The configuration for the EC2 Fleet.

Type: Array of FleetLaunchTemplateConfigRequest objects

Array Members: Minimum number of 0 items. Maximum number of 50 items.

Required: Yes

## OnDemandOptions
Describes the configuration of On-Demand Instances in an EC2 Fleet.

Type: OnDemandOptionsRequest object

Required: No

## ReplaceUnhealthyInstances
Indicates whether EC2 Fleet should replace unhealthy Spot Instances. Supported only for fleets of type maintain. For more information, see EC2 Fleet health checks in the Amazon EC2 User Guide.

Type: Boolean

Required: No

## SpotOptions
Describes the configuration of Spot Instances in an EC2 Fleet.

Type: SpotOptionsRequest object

Required: No

## TagSpecification.N
The key-value pair for tagging the EC2 Fleet request on creation. For more information, see Tag your resources.

If the fleet type is instant, specify a resource type of fleet to tag the fleet or instance to tag the instances at launch.

If the fleet type is maintain or request, specify a resource type of fleet to tag the fleet. You cannot specify a resource type of instance. To tag instances at launch, specify the tags in a launch template.

Type: Array of TagSpecification objects

Required: No

## TargetCapacitySpecification
The number of units to request.

Type: TargetCapacitySpecificationRequest object

Required: Yes

## TerminateInstancesWithExpiration
Indicates whether running instances should be terminated when the EC2 Fleet expires.

Type: Boolean

Required: No

## Type
The fleet type. The default value is maintain.

`maintain` - The EC2 Fleet places an asynchronous request for your desired capacity, and continues to maintain your desired Spot capacity by replenishing interrupted Spot Instances.

`request` - The EC2 Fleet places an asynchronous one-time request for your desired capacity, but does submit Spot requests in alternative capacity pools if Spot capacity is unavailable, and does not maintain Spot capacity if Spot Instances are interrupted.

`instant` - The EC2 Fleet places a synchronous one-time request for your desired capacity, and returns errors for any instances that could not be launched.

For more information, see EC2 Fleet request types in the Amazon EC2 User Guide.

Type: String

Valid Values: request | maintain | instant

Required: No

# FleetLaunchTemplateConfigRequest
Describes a launch template and overrides.

Contents:

## LaunchTemplateSpecification
The launch template to use. You must specify either the launch template ID or launch template name in the request.

Type: FleetLaunchTemplateSpecificationRequest object

Required: No

## Overrides
Any parameters that you specify override the same parameters in the launch template.

For fleets of type request and maintain, a maximum of 300 items is allowed across all launch templates.

Type: Array of FleetLaunchTemplateOverridesRequest objects

Required: No

# FleetLaunchTemplateSpecificationRequest
Describes overrides for a launch template.

Contents:

## AvailabilityZone
The Availability Zone in which to launch the instances.

Type: String

Required: No

## ImageId
The ID of the AMI in the format ami-17characters00000.

Note: This parameter is only available for fleets of type instant. For fleets of type maintain and request, you must specify the AMI ID in the launch template.

Type: String

Required: No

## InstanceRequirements
The attributes for the instance types. When you specify instance attributes, Amazon EC2 will identify instance types with those attributes.

Note: If you specify InstanceRequirements, you can't specify InstanceType.

Type: InstanceRequirementsRequest object

Required: No

## InstanceType
The instance type.

mac1.metal is not supported as a launch template override.

Note : If you specify InstanceType, you can't specify InstanceRequirements.

Type: String

Required: No

## SubnetId
The IDs of the subnets in which to launch the instances. Separate multiple subnet IDs using commas (for example, subnet-1234abcdeexample1, subnet-0987cdef6example2). A request of type instant can have only one subnet ID.

Type: String

Required: No

locals {
  common_tags = merge(
    var.common_tags,
    { Environment = var.env }
  )

  ec2_user_name = "ubuntu"
  ec2_root_dir = "/home/${local.ec2_user_name}/bfx-reports-framework"
  db_volume_device_name = "/dev/xvdf" # TODO: move to var
}

module "network" {
  source = "./modules/network"
  namespace = var.namespace
  vpc_cidr = var.aws_vpc_cidr
  common_tags = local.common_tags
  allowed_ports = var.allowed_ports
}

module "ec2" {
  source = "./modules/ec2"
  namespace = var.namespace
  aws_instance_type = var.aws_instance_type
  aws_instance_detailed_mon = var.aws_instance_detailed_mon
  sec_gr_ids = [module.network.sec_gr_pub_id]
  subnet_id = module.network.vpc.public_subnets[0]
  update_version = var.update_version
  key_name = module.ssh_key.key_name
  private_key = module.ssh_key.private_key
  user_name = local.ec2_user_name
  root_dir = local.ec2_root_dir
  db_volume_device_name = local.db_volume_device_name

  user_data = templatefile("setup.sh.tpl", {
    user_name = local.ec2_user_name
    root_dir = local.ec2_root_dir
    env = var.env
    nginx_autoindex = var.nginx_autoindex
    repo_fork = var.repo_fork
    repo_branch = var.repo_branch
    nginx_port = var.nginx_port
    nginx_host = module.network.public_dns
    secret_key = data.aws_ssm_parameter.secret_key.value
    db_volume_device_name = local.db_volume_device_name
  })

  common_tags = local.common_tags
}

module "ssh_key" {
  source = "./modules/ssh_key"
  key_name = var.key_name
}

resource "random_password" "secret_key" {
  length = 512
  special = false
  number = true
  lower = true
  upper = false
}

resource "aws_ssm_parameter" "secret_key" {
  name = "/${var.env}/encryption/secret_key"
  description = "Encryption secret key"
  type = "SecureString"
  value = random_password.secret_key.result

  tags = merge(
    var.common_tags,
    { Name = "${var.namespace}_SecretKey" }
  )
}

data "aws_ssm_parameter" "secret_key" {
  name = "/${var.env}/encryption/secret_key"

  depends_on = [aws_ssm_parameter.secret_key]
}

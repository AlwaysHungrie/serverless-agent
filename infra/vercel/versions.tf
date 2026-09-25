terraform {
  required_version = ">= 1.6"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.0"
    }
  }
}

# Token from VERCEL_API_TOKEN in the environment.
provider "vercel" {
  team = var.vercel_team
}

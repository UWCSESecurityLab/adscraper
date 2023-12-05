# Crawl cluster setup

## Pre-requisites

- Local / dev environment
  - Docker Desktop
  - `kubectl`
  - `minikube`
- Production environment
  - `containerd` or `cri-dockerd`
  - `kubectl`
  - `kubelet`
  - `kubeadm`

## Setup

1. Set up a cluster
   - Local (Minikube): `minikube start --cni calico --mount --mount-string $(pwd)/test-input:/data --driver=docker`
   - Production: TODO

2. Set up worker nodes
    - Local: `minikube node add worker` (do 2x)
    - Production: TODO

3. Set up a location for storing input and output files - to be mounted to containers
    - Local: pick a local directory to mount
    - Production: make a network volume, mount
      - Edit YAML files to mount

4. Set up a database
    - Create a Postgres database outside of Kubernetes
    - Create the database/tables in db/adscraper.sql
    - Set up a Service and EndpointSlice to make it accessible in
      Kubernetes
      - Edit `postgres-service.yaml` with address/port of database
      - Local: listen on 0.0.0.0, will be accessible to minikube at
        the address `host.minikube.internal`
      - Apply config:

```sh
kubectl apply -f config/postgres-service.yaml
```

5. Set up database secrets
    - Edit `postgres-secret.yaml`; provide base64-encoded values for database, user, and password.
      - Base64 conversion: `echo -n 'password' | base64`
    - Apply config:

```sh
kubectl apply -f config/pg-conf-secret.yaml
```

6. Set up network policy to allow egress for crawls

```sh
kubectl apply -f config/network-policy.yaml
```

7. Set up message queue service

```sh
kubectl create -f config/rabbitmq-service.yaml
kubectl create -f config/rabbitmq-controller.yaml
```

## Run a crawl job

1. Set up directory structure in the storage volume, populate with inputs
   - input/
     - job_id/
     - (crawl lists)
      - output/
      - profiles/

On the control plane node, run `node runjob.js` with the job specification file.


## TODOs

- Figure out container mounts in job.yaml
- Write a script that creates/modifies job.yaml based on the jobspec (number of crawls, mounts, etc.)
- Write the interface for running containers from crawlspecs

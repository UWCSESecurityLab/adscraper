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
   - Local (Minikube): `minikube start --cni calico`
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
    - Edit `pg-conf-secret.yaml`; provide base64-encoded values for database, user, and password.
      - Base64 conversion: `echo -n 'password' | base64
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

8. Build and start the job server

```sh
cd job-server
docker build . -t job-server

# Local/Minikube: load image
minikube image load job-server

# Prod: upload image to registry
# TODO
```

9. Set up ingress for job server

```sh
# Local/Minikube: enable ingress
minikube addons enable ingress
minikube addons enable ingress-dns
minikube tunnel # keep this open
# Ingress resources should be available at 127.0.0.1



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

- Figure out the jobspec format
- Figure out container mounts in job.yaml
- Write a script that creates/modifies job.yaml based on the jobspec (number of crawls, mounts, etc.)
- Figure out the crawlspec that goes into the message queue
- Write the interface for running containers from crawlspecs
- Figure out the command to run the crawl container



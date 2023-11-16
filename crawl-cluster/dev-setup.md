# Development setup instructions

Start cluster, initialize supporting services

```sh
minikube start --cni calico --driver=virtualbox
kubectl apply -f config/postgres-service.yaml
kubectl apply -f config/postgres-secret.yaml
kubectl apply -f config/network-policy.yaml
kubectl apply -f config/rabbitmq-service.yaml
kubectl apply -f config/rabbitmq-controller.yaml
```

In a new terminal window, mount the test-input directory

```sh
minikube mount test-input:/input --uid 999 --uid 999
```

In a new terminal window, open the Kubernetes dashboard:

```sh
minikube dashboard
```

In a new terminal window, get the URL of the postgres external service,
and leave open

```sh
minikube service rabbitmq-service --url
```

Build the crawler image inside Minikube

```sh
eval $(minikube docker-env)
cd ../crawler
docker build . -t adscraper --platform=linux/amd64
```

NOTE:
If using the old and slow `minikube image load adscraper` method instead,
when making changes to the crawler and loading new images, minikube sometimes
doesn't overwrite the old version of the  image, and the stale image gets used in the job.
This fails silently!! To force it to use the latest image, delete all containers and jobs
using the image, run `minikube image rm adscraper` and then try to load it again.

Copy and paste the IP and port into the BROKER_URL variable in
`cli/src/runJob.ts`. Then, build, and run:

```sh
cd cli
npm run build
node gen/runJob.js
```



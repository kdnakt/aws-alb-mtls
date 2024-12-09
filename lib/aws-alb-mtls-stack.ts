import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from "path";
import * as fs from 'fs';

export class AwsAlbMtlsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Route 53 Hosted Zone
    const zoneName = "kdnakt.com";
    const hostedZone = cdk.aws_route53.PublicHostedZone.fromHostedZoneAttributes(this, "MyHostedZone", {
      zoneName,
      hostedZoneId: "Z15H9R9Z4PZ27T"
    });

    // ACM
    const certificate = new cdk.aws_certificatemanager.Certificate(
      this,
      "Certificate",
      {
        domainName: `mtls-test.kdnakt.com`,
        validation: cdk.aws_certificatemanager.CertificateValidation.fromDns(
          hostedZone,
        ),
      }
    );

    // Trust store and connection log S3 Bucket
    const bucket = new cdk.aws_s3.Bucket(this, "Bucket", {
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: new cdk.aws_s3.BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      }),
      enforceSSL: true,
      versioned: false,
    });
    bucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["s3:PutObject"],
        principals: [new cdk.aws_iam.AccountPrincipal("582318560864")],
        resources: [`${bucket.bucketArn}/*`],
      })
    );

    // Deploy CA cert
    const deployCaCert = new cdk.aws_s3_deployment.BucketDeployment(
      this,
      "DeployCaCert",
      {
        sources: [
          cdk.aws_s3_deployment.Source.data(
            "root_cert.pem",
            fs.readFileSync(path.join(__dirname, "../root_cert.pem"), "utf8")
          ),
        ],
        destinationBucket: bucket,
        extract: true,
      }
    );

    // Trust store
    const cfnTrustStore = new cdk.aws_elasticloadbalancingv2.CfnTrustStore(
      this,
      "TrustStore",
      {
        caCertificatesBundleS3Bucket: deployCaCert.deployedBucket.bucketName,
        caCertificatesBundleS3Key: "root_cert.pem",
        name: "trust-store",
      }
    );
    cfnTrustStore.node.addDependency(deployCaCert);

    const vpc = new cdk.aws_ec2.Vpc(this, "MyVPC", {
      ipAddresses: cdk.aws_ec2.IpAddresses.cidr("10.10.10.0/24"),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
          cidrMask: 27,
          mapPublicIpOnLaunch: true,
        },
      ],
    });

    // ALB
    const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "MyALB",
      {
        vpc,
        internetFacing: true,
        vpcSubnets: {
          subnets: vpc.publicSubnets,
        },
      }
    );

    const cfnAlb = alb.node.defaultChild as cdk.aws_elasticloadbalancingv2.CfnLoadBalancer;

    cfnAlb.loadBalancerAttributes = [
      {
        key: "connection_logs.s3.enabled",
        value: "true",
      },
      {
        key: "connection_logs.s3.bucket",
        value: bucket.bucketName,
      },
    ];

    // Listener
    const listenerHttps = alb.addListener("ListenerHttps", {
      port: 443,
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      sslPolicy: cdk.aws_elasticloadbalancingv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction:
        cdk.aws_elasticloadbalancingv2.ListenerAction.fixedResponse(200, {
          contentType: "text/plain",
          messageBody: "mTLS success!",
        }),
    });

    const cfnListenerHttps = listenerHttps.node
      .defaultChild as cdk.aws_elasticloadbalancingv2.CfnListener;
    cfnListenerHttps.mutualAuthentication = {
      ignoreClientCertificateExpiry: false,
      mode: "verify",
      trustStoreArn: cfnTrustStore.ref,
    };

    // Alias
    new cdk.aws_route53.ARecord(this, "Alias", {
      zone: hostedZone,
      recordName: `mtls-test.${zoneName}`,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.LoadBalancerTarget(alb)
      ),
    });
  }
}

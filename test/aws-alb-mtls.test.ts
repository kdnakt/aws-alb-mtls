import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as AwsAlbMtls from '../lib/aws-alb-mtls-stack';

test('ALB with mTLS is properly configured', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new AwsAlbMtls.AwsAlbMtlsStack(app, 'MyTestStack');
  // THEN
  const template = Template.fromStack(stack);

  // ALBリソースが存在することを確認
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  
  // mTLS設定が正しいことを確認
  template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
    Protocol: 'HTTPS',
    Port: 443,
    SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
  });
  
  // TrustStoreが作成されていることを確認
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::TrustStore', 1);
});

# Aweborn.org — Project Complete

The immersive 3D donation experience for Aweborn has been successfully built and deployed!

## What was built

1. **Immersive 3D Experience**: A stunning cosmic environment built with React Three Fiber, featuring volumetric clouds, starfields, floating islands, and a discoverable glowing donation portal.
2. **Design System**: A premium, dark-themed UI overlay with glassmorphism effects, a loading sequence, and a heads-up display.
3. **Stripe Integration**: A customized donation modal supporting preset amounts ($10–$500) and custom inputs, integrated with a serverless AWS backend to securely create Stripe Checkout sessions.
4. **Infrastructure as Code**: A complete, robust AWS foundation defined in a single CloudFormation template (`infra/cloudformation.yml`). It provisions:
   - S3 Bucket for static asset hosting
   - CloudFront CDN for global, fast delivery and HTTPS (with Origin Access Control)
   - ACM TLS Certificate and Route53 DNS for `aweborn.org` and `www.aweborn.org`
   - API Gateway and a Lambda function (Node.js) acting as a secure proxy to Stripe
5. **CI/CD Pipeline**: A GitHub Actions workflow (`.github/workflows/deploy.yml`) using secure OIDC (OpenID Connect) authentication to automatically build the Vite app, sync to S3, and invalidate the CloudFront cache upon pushes to the `main` branch.

## How it works together

- When a user visits `https://aweborn.org`, CloudFront serves the static Vite (React) application directly from the private S3 bucket.
- The 3D scene loads and the user explores until they click the glowing Donation Portal.
- Upon clicking "Donate" in the modal, the React app calls the API Gateway endpoint.
- API Gateway invokes the Lambda function, which securely uses the Stripe API (with the hidden `STRIPE_SECRET_KEY`) to generate a unique Checkout Session URL.
- The user is redirected to Stripe's secure hosted payment page.
- After payment, Stripe redirects the user back to `aweborn.org` (either success or cancellation).

## What you need to do next

The site is live, but it currently uses a placeholder Stripe key. To enable real donations:

1. **Get your Stripe Secret Key**: Once your Stripe non-profit account is approved and ready for live transactions, obtain your live Secret Key (`sk_live_...`).
2. **Update the AWS Stack**: You can update the CloudFormation stack to inject the real key into the Lambda function. Run this command locally (replace `<YOUR_KEY>`):
   ```bash
   aws cloudformation deploy \
     --template-file infra/cloudformation.yml \
     --stack-name aweborn-website \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides \
         HostedZoneId=Z077908710IGH7R1XO587 \
         StripeSecretKey="<YOUR_KEY>"
   ```
3. *(Optional)* **Webhooks**: If you need to trigger backend actions (like sending an automated email or saving the donor to a database) when a donation succeeds, you can expand the Lambda function to handle Stripe webhooks in the future.

> [!TIP]
> **Testing locally**: You can always run `npm run dev` in `~/repos/github.com/aweborn/aweborn.org` to explore the 3D scene and test UI changes locally.

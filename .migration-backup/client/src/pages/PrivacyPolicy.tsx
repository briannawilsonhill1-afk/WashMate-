import { motion } from 'framer-motion';
import { Shield, Lock, Eye, MapPin, Shirt, Users, FileText, ArrowLeft, Droplets, AlertTriangle } from 'lucide-react';
import { Link } from 'wouter';
import { useAuth } from '@/hooks/use-auth';

const sections = [
  {
    icon: Lock,
    title: "Information We Collect",
    content: [
      "Account details: username, role (customer or washer), and address.",
      "Order details: load size, service preferences, pickup and delivery addresses, scheduling information, and payment amounts.",
      "Usage data: how you interact with WashMate to improve our services.",
    ],
  },
  {
    icon: MapPin,
    title: "Address & Location Privacy",
    content: [
      "Customer addresses are strictly confidential and are only shared with the specific washer assigned to that customer's order. This information must remain private between the customer and their assigned washer at all times.",
      "Washers are prohibited from sharing, disclosing, publishing, or making public any customer address or location information, whether during or after an order.",
      "Customer addresses must not be stored, written down, photographed, or retained in any form by the washer beyond what is necessary to complete the active order.",
      "Washer addresses are never shared with customers or other washers.",
      "Address information is used solely for pickup and delivery coordination and is never sold, rented, or disclosed to third parties.",
      "Once an order is completed, the washer must treat the customer's address as confidential and may not use it for any purpose outside of WashMate.",
      "Any unauthorized sharing or public disclosure of a customer's address is a violation of this policy and may result in immediate removal from the platform and potential legal action.",
    ],
  },
  {
    icon: Shirt,
    title: "Belongings & Item Confidentiality",
    content: [
      "Washers are contractually obligated to handle all customer belongings with care and discretion.",
      "Details about laundry items, special instructions, and personal preferences are kept strictly confidential.",
      "Washers may not photograph, disclose, or discuss the contents of any customer's laundry with anyone outside the platform.",
      "Any damage or loss of belongings must be reported immediately through the platform for resolution.",
    ],
  },
  {
    icon: Users,
    title: "Washer Confidentiality Obligations",
    content: [
      "Washers agree to maintain full confidentiality regarding all customer information encountered during service.",
      "Customer addresses, order history, and personal details must not be retained, copied, or shared after an order is complete.",
      "Violation of confidentiality obligations may result in immediate removal from the WashMate platform.",
      "Washers must securely handle all items during pickup, washing, and delivery.",
    ],
  },
  {
    icon: AlertTriangle,
    title: "Liability & Risk Acknowledgment",
    content: [
      "By using WashMate, customers acknowledge and agree that the washing, handling, and transport of personal items carries inherent risks, including but not limited to damage, shrinkage, color bleeding, or loss of items.",
      "Washers are independent service providers and are not held liable for missing, damaged, or lost items that may occur during the laundry process, pickup, or delivery.",
      "Customers agree that they use WashMate's services at their own risk and accept full responsibility for any items submitted for washing.",
      "Customers are advised not to include high-value, irreplaceable, or sentimental items in their laundry orders. WashMate and its washers assume no liability for such items.",
      "By placing an order, customers confirm that they have read and understood this policy and agree to these terms as a binding acknowledgment of risk.",
    ],
  },
  {
    icon: Eye,
    title: "How We Use Your Information",
    content: [
      "To match customers with available washers and facilitate order completion.",
      "To calculate accurate pricing based on load size, distance, and service options.",
      "To communicate order updates, scheduling changes, and service notifications.",
      "To resolve disputes, process refunds, and provide customer support.",
    ],
  },
  {
    icon: Shield,
    title: "Data Protection & Security",
    content: [
      "All personal data is stored securely and access is limited to authorized personnel only.",
      "We do not sell, rent, or trade your personal information to third parties for marketing purposes.",
      "You may request deletion of your account and associated data at any time by contacting our support team.",
      "We retain order history only as long as necessary for service improvement and legal compliance.",
    ],
  },
  {
    icon: FileText,
    title: "Your Rights",
    content: [
      "Access the personal data we hold about you at any time.",
      "Request correction of inaccurate or incomplete information.",
      "Request deletion of your account and personal data.",
      "Opt out of non-essential communications and notifications.",
      "File a complaint if you believe your data rights have been violated.",
    ],
  },
];

export default function PrivacyPolicy() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Link href={user ? (user.role === 'customer' ? '/customer' : '/washer') : '/'}>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 cursor-pointer" data-testid="link-back">
              <ArrowLeft className="w-4 h-4" />
              Back to {user ? 'Dashboard' : 'Login'}
            </span>
          </Link>

          <div className="flex items-center gap-3 mb-2 mt-4">
            <div className="bg-primary/10 p-2.5 rounded-xl text-primary">
              <Shield className="w-7 h-7" />
            </div>
            <h1 className="font-display text-3xl font-bold text-foreground tracking-tight" data-testid="text-privacy-title">
              Privacy Policy
            </h1>
          </div>
          <p className="text-muted-foreground mb-8 ml-[52px]" data-testid="text-privacy-subtitle">
            How WashMate protects your information, your belongings, and your privacy.
          </p>

          <div className="space-y-6">
            {sections.map((section, index) => (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm"
                data-testid={`card-privacy-section-${index}`}
              >
                <div className="flex items-start gap-4">
                  <div className="bg-primary/10 p-2 rounded-xl text-primary shrink-0 mt-0.5">
                    <section.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display text-lg font-semibold text-foreground mb-3">
                      {section.title}
                    </h2>
                    <ul className="space-y-2">
                      {section.content.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-8 p-6 bg-card rounded-2xl border border-border/50 text-center"
            data-testid="card-privacy-contact"
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <Droplets className="w-5 h-5 text-primary" />
              <span className="font-display font-semibold text-foreground">
                Wash<span className="text-primary">Mate</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Questions about our privacy practices? Contact our support team for assistance.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              Last updated: February 2026
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

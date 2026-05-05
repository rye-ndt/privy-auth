import { HeroSection } from './sections/HeroSection'
import { ProblemSection } from './sections/ProblemSection'
import { DemoSection } from './sections/DemoSection'
import { SafetySection } from './sections/SafetySection'
import { FeaturesSection } from './sections/FeaturesSection'
import { HowItWorksSection } from './sections/HowItWorksSection'
import { InvestorsSection } from './sections/InvestorsSection'
import { TechSecuritySection } from './sections/TechSecuritySection'
import { FAQSection } from './sections/FAQSection'
import { Footer } from './sections/Footer'
import { RoadmapSection } from './sections/RoadmapSection'

function App() {
  return (
    <div className="min-h-screen bg-[#0f0f1a] text-white selection:bg-violet-500/30">
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <DemoSection />
      <FeaturesSection />
      <RoadmapSection />
      <TechSecuritySection />
      <SafetySection />
      <InvestorsSection />
      <FAQSection />
      <Footer />
    </div>
  )
}

export default App

import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
const db = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seed is forbidden in production");
  const passwordHash = await hash("BuildTogether2026!", 12);
  const demo = await db.user.upsert({
    where: { email: "demo@projectconnect.dev" },
    update: {
      passwordHash,
      suspendedAt: null,
      activationRequired: false,
      emailVerifiedAt: new Date(),
      passwordSet: true,
    },
    create: {
      email: "demo@projectconnect.dev",
      emailVerifiedAt: new Date(),
      passwordHash,
      name: "Nivas Kumar",
      initials: "NK",
      role: "Developer & maker",
      city: "Coimbatore, India",
      bio: "Turning coffee and curiosity into things that work. Into robotics, AI, and building with good people.",
      skills: ["Python", "Robotics", "IoT", "React"],
      interests: ["Robotics", "AI & ML", "Sustainability"],
      color: "cyan",
    },
  });
  const names = [
    [
      "Priya Sharma",
      "PS",
      "purple",
      "AI researcher",
      "Python,TensorFlow,AI & ML",
    ],
    [
      "Arjun Patel",
      "AP",
      "orange",
      "Embedded systems engineer",
      "Arduino,IoT,Electronics",
    ],
    [
      "Rahul Menon",
      "RM",
      "green",
      "Full-stack developer",
      "React,TypeScript,Node.js",
    ],
    ["Meera Krishnan", "MK", "pink", "Product designer", "Figma,UI/UX,React"],
    ["Aditya Rao", "AR", "blue", "Robotics engineer", "ROS,Python,Robotics"],
    [
      "Sara Thomas",
      "ST",
      "yellow",
      "Climate tech enthusiast",
      "Python,Sustainability,IoT",
    ],
  ];
  const people = [];
  for (const [name, initials, color, role, skills] of names) {
    people.push(
      await db.user.upsert({
        where: { email: initials.toLowerCase() + "@example.com" },
        update: {
          activationRequired: false,
          emailVerifiedAt: new Date(),
          passwordSet: true,
        },
        create: {
          email: initials.toLowerCase() + "@example.com",
          emailVerifiedAt: new Date(),
          passwordHash,
          name,
          initials,
          color,
          role,
          city: "Coimbatore, India",
          bio: "Love solving interesting problems and building with a team.",
          skills: skills.split(","),
          interests: skills.split(",").slice(0, 2),
        },
      }),
    );
  }
  const projects = [
    [
      "Autonomous Drone Navigation",
      "Build a smarter eye in the sky. We’re developing an autonomous drone that uses computer vision to navigate obstacles and map its surroundings. Looking for curious builders to bring this idea to life.",
      "drone",
      "Robotics",
      ["Robotics", "Python", "Computer Vision"],
      ["Python", "Robotics", "OpenCV"],
      ["AI Developer", "Electronics Engineer", "Drone Specialist"],
      people[4].id,
    ],
    [
      "Smart Energy Monitor",
      "Make every watt count. An IoT-powered home energy monitor with real-time insights, usage forecasts, and a beautiful dashboard. Help us make homes a little greener.",
      "energy",
      "IoT",
      ["IoT", "Electronics", "Arduino"],
      ["IoT", "Arduino", "Electronics"],
      ["Embedded Developer", "Frontend Developer"],
      people[1].id,
    ],
    [
      "AI-Powered Agriculture",
      "Grow more, waste less. Using machine learning and low-cost sensors to help small farms make better irrigation and crop-health decisions.",
      "agriculture",
      "AI & ML",
      ["AI & ML", "IoT", "Python"],
      ["Python", "IoT", "TensorFlow"],
      ["ML Engineer", "IoT Developer"],
      people[0].id,
    ],
    [
      "Open Source Campus Hub",
      "A student-built platform to find campus events, share resources, and bring communities together. Open source from day one.",
      "campus",
      "Web development",
      ["React", "TypeScript", "Open Source"],
      ["React", "TypeScript"],
      ["Frontend Developer", "UI/UX Designer"],
      people[2].id,
    ],
    [
      "A More Accessible Web",
      "A lightweight toolkit that helps developers test accessibility and create better experiences for everyone.",
      "design",
      "Design",
      ["UI/UX", "Accessibility", "React"],
      ["React", "Figma"],
      ["UI/UX Designer", "React Developer"],
      people[3].id,
    ],
    [
      "Community Air Quality Network",
      "Help your neighborhood breathe easier. Build an open network of low-cost air-quality sensors and a live pollution dashboard.",
      "energy",
      "IoT",
      ["IoT", "Sustainability", "Python"],
      ["IoT", "Python"],
      ["Hardware Engineer", "Data Analyst"],
      people[5].id,
    ],
  ] as const;
  for (let i = 0; i < projects.length; i++) {
    let [
      title,
      description,
      img,
      category,
      tags,
      requiredSkills,
      positions,
      ownerId,
    ] = projects[i];
    await db.project.upsert({
      where: { id: "seed-project-" + i },
      update: {},
      create: {
        id: "seed-project-" + i,
        title,
        description,
        image:
          "/images/" +
          (img === "campus" || img === "design" ? "energy" : img) +
          ".svg",
        category,
        tags: [...tags],
        requiredSkills: [...requiredSkills],
        positions: [...positions],
        ownerId,
        city: "Coimbatore, India",
        remote: i > 2,
        teamSize: i === 0 ? 5 : 4,
        createdAt: new Date(Date.now() - (i + 1) * 86400000),
        members: {
          create: [
            { userId: ownerId, role: "Owner" },
            ...(i === 0 ? [{ userId: demo.id, role: "Member" }] : []),
          ],
        },
      },
    });
  }
  await db.connection.upsert({
    where: {
      senderId_receiverId: { senderId: demo.id, receiverId: people[0].id },
    },
    update: {},
    create: {
      senderId: demo.id,
      receiverId: people[0].id,
      userLowId: [demo.id, people[0].id].sort()[0],
      userHighId: [demo.id, people[0].id].sort()[1],
      status: "Accepted",
    },
  });
  const resources = [
    [
      "OpenCV documentation",
      "Computer vision algorithms, tutorials and API references.",
      "https://docs.opencv.org/",
      "Documentation",
      ["Python", "Computer Vision"],
    ],
    [
      "Arduino documentation",
      "Learn about Arduino boards, embedded programming and hardware.",
      "https://docs.arduino.cc/",
      "Documentation",
      ["Arduino", "IoT"],
    ],
    [
      "ROS 2 documentation",
      "Build robotics applications with the Robot Operating System.",
      "https://docs.ros.org/en/rolling/",
      "Documentation",
      ["Robotics", "ROS"],
    ],
    [
      "Next.js documentation",
      "Build full-stack React applications with the App Router.",
      "https://nextjs.org/docs",
      "Documentation",
      ["React", "TypeScript"],
    ],
    [
      "TensorFlow tutorials",
      "Get started with machine learning models and training.",
      "https://www.tensorflow.org/tutorials",
      "Tutorial",
      ["Python", "AI & ML"],
    ],
    [
      "Public APIs directory",
      "A community-maintained directory of publicly available APIs.",
      "https://github.com/public-apis/public-apis",
      "GitHub",
      ["API", "Open Source"],
    ],
  ] as const;
  for (const [title, description, url, type, tags] of resources)
    await db.resource.upsert({
      where: { url },
      update: {},
      create: {
        title,
        description,
        url,
        type,
        tags: [...tags],
        submittedById: demo.id,
      },
    });
  const stores = [
    [
      "Sample: Gandhipuram Electronics Hub",
      "Cross Cut Road, Gandhipuram",
      "Coimbatore",
      11.0183,
      76.9674,
      "Arduino boards, sensors, breadboards and basic components.",
      ["ECE", "Sensors"],
    ],
    [
      "Sample: RS Puram Drone Parts",
      "DB Road, RS Puram",
      "Coimbatore",
      11.0062,
      76.9502,
      "Brushless motors, ESCs, propellers and LiPo accessories.",
      ["Drone", "Motors"],
    ],
    [
      "Sample: Peelamedu Robotics Store",
      "Avinashi Road, Peelamedu",
      "Coimbatore",
      11.0279,
      77.0006,
      "Robot chassis kits, servo motors and motor drivers.",
      ["Robotics", "Motors"],
    ],
    [
      "Sample: Saibaba Colony 3D Print Lab",
      "NSR Road, Saibaba Colony",
      "Coimbatore",
      11.0247,
      76.942,
      "FDM printing, filament and quick prototyping service.",
      ["3D Printing"],
    ],
    [
      "Sample: Ukkadam PCB Works",
      "Ukkadam Main Road",
      "Coimbatore",
      10.9925,
      76.961,
      "PCB prototyping, soldering supplies and test equipment.",
      ["PCB", "ECE"],
    ],
  ] as const;
  for (const [
    i,
    [name, address, city, lat, lng, description, categories],
  ] of stores.entries())
    await db.hardwareStore.upsert({
      where: { id: "sample-store-" + i },
      update: {},
      create: {
        id: "sample-store-" + i,
        name,
        address,
        city,
        lat,
        lng,
        description,
        categories: [...categories],
        hours: "Hours not verified",
        status: "Approved",
        sample: true,
      },
    });
  for (let i = 0; i < 3; i++)
    await db.activity.upsert({
      where: { id: "sample-update-" + i },
      update: {},
      create: {
        id: "sample-update-" + i,
        authorId: projects[i][7],
        projectId: "seed-project-" + i,
        content: [
          "We’re starting with simulation before connecting real drone hardware. Looking for teammates excited about safe, incremental testing.",
          "Our first prototype goal: calibrate one sensor and stream its readings to a simple dashboard.",
          "Data quality comes first. We’re planning a small, clearly labeled dataset before training our first baseline.",
        ][i],
      },
    });
  console.log(
    "Seeded demo account: demo@projectconnect.dev / BuildTogether2026!",
  );
}
main().finally(() => db.$disconnect());

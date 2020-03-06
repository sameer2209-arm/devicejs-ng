pipeline {
  agent none
  options{
    skipDefaultCheckout()
  }
  stages {
    stage('Environment setup'){
    agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
      steps{
        sh 'curl -sL https://deb.nodesource.com/setup_12.x'
        sh 'sudo apt-get install -y nodejs'
      }
    }
    stage('Fetch Code'){
      agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
      steps{
        checkout scm
      }
    }
    stage('Build') {
      agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
       steps {
        sh './build.sh'
      }
    }
    
    stage('Test and Code Review') {
      parallel {
        stage('Test'){
          agent{
            label 'noi-linux-ubuntu16-ci-slave'
          }
          steps {
            sh 'npm install mocha-junit-reporter --save-dev'
            sh './node_modules/mocha/bin/mocha test --reporter mocha-junit-reporter'
          }
        }
        
        stage('SonarQube'){
          agent{
            label 'master'
          }
          environment {
            scannerHome = tool 'SonarQubeScanner'
          }
          steps {
            withSonarQubeEnv('sonarqube') {
              //sh 'id -un'
              sh "${scannerHome}/bin/sonar-scanner"
            }
          }
        }
      }
    }
    
    stage('Auto Doc') {
      agent{
        label 'noi-linux-ubuntu16-ci-slave'
      }
      steps {
        sh 'npm -g install yuidocjs'
        sh 'yuidoc .'
      }
    }
  }
  
  post{
    /*success{
      //slackSend(channel: '#edge-jenkins-ci', color: 'good', message: "JOB NAME: ${env.JOB_NAME}\nBUILD NUMBER: ${env.BUILD_NUMBER}\nSTATUS: ${currentBuild.currentResult}\n${env.RUN_DISPLAY_URL}")
    }
    failure{
      //slackSend(channel: '#edge-jenkins-ci', color: 'danger', message: "JOB NAME: ${env.JOB_NAME}\nBUILD NUMBER: ${env.BUILD_NUMBER}\nSTATUS: ${currentBuild.currentResult}\n${env.RUN_DISPLAY_URL}")
    }
    unstable{
      //slackSend(channel: '#edge-jenkins-ci', color: 'warning', message: "JOB NAME: ${env.JOB_NAME}\nBUILD NUMBER: ${env.BUILD_NUMBER}\nSTATUS: ${currentBuild.currentResult}\n${env.RUN_DISPLAY_URL}")
    }*/
    always{
      node('noi-linux-ubuntu16-ci-slave'){
        junit 'test-results.xml'
        //step([$class: 'CoberturaPublisher', autoUpdateHealth: false, autoUpdateStability: false, coberturaReportFile: 'coverage.xml', failUnhealthy: false, failUnstable: false, maxNumberOfBuilds: 0, onlyStable: false, sourceEncoding: 'ASCII', zoomCoverageChart: false])
        //archiveArtifacts artifacts: 'devicedb_docs.md'
      }
    }
 }
}
